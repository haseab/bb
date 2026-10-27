import os from "node:os";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  createCodexAppServerConnection,
  type CodexAppServerConnection,
} from "./bridge/app-server-connection.js";
import { resolveAppServerLaunch } from "./bridge/bridge.js";
import { resolveCodexHome } from "./codex-home.js";
import { codexSessionMetadataSchema } from "./session-sync-contract.js";
import {
  createCodexEventTranslationState,
  translateCodexEventToDeltas,
} from "./delta-translation.js";
import {
  experimental_nativeSessionSnapshotSchema as nativeSessionSnapshotSchema,
  type ExperimentalNativeSessionSnapshot as NativeSessionSnapshot,
  type ThreadDelta,
} from "@get-bb/plugin-sdk/provider-bridge";

const pageSchema = z.object({
  data: z.array(codexSessionMetadataSchema),
  nextCursor: z.string().nullable(),
});
const turnSchema = z
  .object({
    id: z.string(),
    status: z.enum(["completed", "failed", "interrupted", "inProgress"]),
    items: z.array(z.unknown()),
    startedAt: z.number().nullable().optional(),
    completedAt: z.number().nullable().optional(),
    error: z.object({ message: z.string() }).nullable(),
  })
  .passthrough();
const turnsSchema = z.object({
  data: z.array(turnSchema),
  nextCursor: z.string().nullable(),
});
const userMessageSchema = z.object({
  type: z.literal("userMessage"),
  id: z.string(),
  content: z.array(z.unknown()),
});
const lifecycleSchema = z.object({
  type: z.literal("event_msg"),
  payload: z
    .object({ type: z.string(), turn_id: z.string().optional() })
    .passthrough(),
});

export class CodexSessionReader {
  constructor(
    private readonly createConnection = createCodexAppServerConnection,
  ) {}

  private connection: Promise<CodexAppServerConnection> | null = null;
  private disposed = false;
  private readonly lifecycle = new Map<
    string,
    { offset: number; partial: string; activeTurnId: string | null }
  >();

  private async connect(): Promise<CodexAppServerConnection> {
    if (this.disposed) throw new Error("Codex session reader is disposed");
    this.connection ??= (async () => {
      const launch = resolveAppServerLaunch();
      const connection = this.createConnection({
        ...launch,
        cwd: os.homedir(),
        env: process.env,
        recordThreadId: null,
        onNotification() {},
        onRequest(_method, _params, responder) {
          responder.error(-32601, "History reader does not execute requests");
        },
        onExit: () => {
          this.connection = null;
        },
      });
      try {
        await connection.request({
          method: "initialize",
          params: {
            clientInfo: {
              name: "bb-history",
              version: "1.0.0",
              title: "bb conversation sync",
            },
            capabilities: { experimentalApi: true },
          },
          resultSchema: z.unknown(),
          timeoutMs: 10_000,
        });
        return connection;
      } catch (error) {
        await connection.kill();
        this.connection = null;
        throw error;
      }
    })();
    return this.connection;
  }

  async list(input: { cwd: string[]; cursor: string | null }) {
    return (await this.connect()).request({
      method: "thread/list",
      params: {
        ...input,
        limit: 100,
        sortKey: "updated_at",
        sourceKinds: ["cli", "vscode", "appServer"],
        archived: false,
      },
      resultSchema: pageSchema,
      timeoutMs: 15_000,
    });
  }

  private async activeTurn(
    rolloutPath: string | null | undefined,
  ): Promise<string | null> {
    if (!rolloutPath) return null;
    const root = resolveCodexHome(os.homedir(), process.env);
    const relative = path.relative(root, rolloutPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const info = await stat(rolloutPath).catch(() => null);
    if (!info) return null;
    let state = this.lifecycle.get(rolloutPath);
    if (!state || info.size < state.offset) {
      state = { offset: 0, partial: "", activeTurnId: null };
      this.lifecycle.set(rolloutPath, state);
    }
    const file = await open(rolloutPath, "r");
    try {
      while (state.offset < info.size) {
        const buffer = Buffer.alloc(
          Math.min(256 * 1024, info.size - state.offset),
        );
        const { bytesRead } = await file.read(
          buffer,
          0,
          buffer.length,
          state.offset,
        );
        if (!bytesRead) break;
        state.offset += bytesRead;
        const lines = (
          state.partial + buffer.toString("utf8", 0, bytesRead)
        ).split("\n");
        state.partial = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.includes('"event_msg"')) continue;
          let raw: unknown;
          try {
            raw = JSON.parse(line);
          } catch {
            continue;
          }
          const parsed = lifecycleSchema.safeParse(raw);
          if (!parsed.success) continue;
          const event = parsed.data.payload;
          if (event.type === "task_started" && event.turn_id)
            state.activeTurnId = event.turn_id;
          if (
            (event.type === "task_complete" || event.type === "turn_aborted") &&
            (!event.turn_id || event.turn_id === state.activeTurnId)
          )
            state.activeTurnId = null;
        }
        if (state.partial.length > 8 * 1024 * 1024)
          throw new Error(
            "Codex rollout line exceeds the history reader limit",
          );
      }
    } finally {
      await file.close();
    }
    return state.activeTurnId;
  }

  async read(input: { threadId: string; cursor: string | null }) {
    const connection = await this.connect();
    const { thread } = await connection.request({
      method: "thread/read",
      params: { threadId: input.threadId },
      resultSchema: z.object({ thread: codexSessionMetadataSchema }),
      timeoutMs: 15_000,
    });
    const activeTurnId = await this.activeTurn(thread.path);
    const page = await connection.request({
      method: "thread/turns/list",
      params: {
        threadId: input.threadId,
        cursor: input.cursor,
        limit: 25,
        sortDirection: "asc",
        itemsView: "full",
      },
      resultSchema: turnsSchema,
      timeoutMs: 15_000,
    });
    const turns: NativeSessionSnapshot["turns"] = page.data.map((turn) => {
      const state = createCodexEventTranslationState();
      const deltas: ThreadDelta[] = [
        { kind: "turn.open", providerTurnId: turn.id },
      ];
      for (const item of turn.items) {
        deltas.push(
          ...translateCodexEventToDeltas(
            {
              method: "item/completed",
              params: { threadId: thread.id, turnId: turn.id, item },
            },
            state,
          ),
        );
      }
      if (turn.id !== activeTurnId && turn.status !== "inProgress") {
        deltas.push({
          kind: "turn.boundary",
          providerTurnId: turn.id,
          providerCheckpointId: turn.id,
          status: turn.status,
          ...(turn.error ? { error: { message: turn.error.message } } : {}),
        });
      }
      const userMessages = turn.items.flatMap((item) => {
        const parsed = userMessageSchema.safeParse(item);
        if (!parsed.success) return [];
        const content = parsed.data.content.flatMap((part) => {
          const parsedPart =
            nativeSessionSnapshotSchema.shape.turns.element.shape.userMessages.element.shape.content.element.safeParse(
              part,
            );
          return parsedPart.success ? [parsedPart.data] : [];
        });
        return [{ id: parsed.data.id, content }];
      });
      return {
        userMessages,
        id: turn.id,
        completedAt:
          turn.completedAt === null || turn.completedAt === undefined
            ? null
            : turn.completedAt * 1000,
        createdAt: (turn.startedAt ?? thread.createdAt) * 1000,
        deltas,
      };
    });
    return {
      session: {
        providerId: "codex",
        providerThreadId: thread.id,
        cwd: thread.cwd,
        title: thread.name ?? thread.preview,
        createdAt: thread.createdAt * 1000,
        updatedAt: thread.updatedAt * 1000,
        active: activeTurnId !== null,
        turns,
      },
      nextCursor: page.nextCursor,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const connection = await this.connection?.catch(() => null);
    this.connection = null;
    await connection?.kill();
    this.lifecycle.clear();
  }
}
