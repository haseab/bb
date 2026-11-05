import { createHash } from "node:crypto";
import { z } from "zod";
import { cliCommand, type BbPluginApi } from "@get-bb/plugin-sdk";
import { openThreadListDatabase } from "../storage.js";
import type { createPreferenceStore } from "../server.js";
import {
  DECISIONS_CHANGED_CHANNEL,
  decisionResultSchema,
  quickDecisionSchema,
  type QuickDecision,
  type QuickDecisionsState,
} from "../shared/decisions.js";
import { decisionPrompt } from "./prompt.js";

type Thread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;
const completionSchema = z.object({ text: z.string() }).strict();

export function createDecisionPolicy(
  bb: BbPluginApi,
  preferences: ReturnType<typeof createPreferenceStore>,
) {
  const db = openThreadListDatabase(bb);
  let disposed = false;
  let inference = Promise.resolve();
  const versions = new Map<string, number>();
  const working = new Map<
    string,
    { key: string; controller: AbortController; done: Promise<void> }
  >();
  const rows = () =>
    quickDecisionSchema
      .array()
      .parse(
        db
          .prepare(
            "SELECT * FROM quick_decisions WHERE level <> 'normal' ORDER BY classifiedAt, threadId",
          )
          .all(),
      );
  const get = (id: string) => {
    const value = db
      .prepare("SELECT * FROM quick_decisions WHERE threadId = ?")
      .get(id);
    return value === undefined ? null : quickDecisionSchema.parse(value);
  };
  const put = (item: QuickDecision) =>
    db
      .prepare(
        "INSERT INTO quick_decisions (threadId, requestKey, interactionId, level, reason, classifiedAt) VALUES (@threadId, @requestKey, @interactionId, @level, @reason, @classifiedAt) ON CONFLICT(threadId) DO UPDATE SET requestKey=excluded.requestKey, interactionId=excluded.interactionId, level=excluded.level, reason=excluded.reason, classifiedAt=excluded.classifiedAt",
      )
      .run(item);
  const publish = () => {
    if (!disposed)
      bb.realtime.publish(DECISIONS_CHANGED_CHANNEL, { items: rows() });
  };
  function clear(threadId: string) {
    versions.set(threadId, (versions.get(threadId) ?? 0) + 1);
    working.get(threadId)?.controller.abort();
    working.delete(threadId);
    const previous = get(threadId);
    db.prepare("DELETE FROM quick_decisions WHERE threadId = ?").run(threadId);
    if (previous && previous.level !== "normal") publish();
  }
  const eligible = (thread: Thread) =>
    thread.visibility === "visible" &&
    thread.archivedAt === null &&
    thread.deletedAt === null &&
    (thread.status === "idle" || thread.status === "active");

  async function inOpenThread(thread: Thread): Promise<boolean> {
    const completed = await preferences.read("completedSectionId");
    const visited = new Set<string>();
    let current = thread;
    while (!visited.has(current.id)) {
      visited.add(current.id);
      if (
        current.archivedAt !== null ||
        current.deletedAt !== null ||
        current.visibility !== "visible" ||
        (current.sectionId !== null && current.sectionId === completed)
      )
        return false;
      if (current.parentThreadId === null) return true;
      current = await bb.sdk.threads.get({ threadId: current.parentThreadId });
    }
    return false;
  }

  async function request(threadId: string, assistantText?: string | null) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!eligible(thread) || !(await inOpenThread(thread))) return null;
    const pending = (
      await bb.sdk.threads.interactions.list({ threadId })
    ).filter((item) => item.status === "pending");
    if (pending.length > 1 || (!pending.length && thread.status !== "idle"))
      return null;
    const interaction = pending[0] ?? null;
    const output =
      assistantText ?? (await bb.sdk.threads.output({ threadId })).output;
    if (!interaction && !output?.trim()) return null;
    const previousUser = await bb.sdk.threads.events.list({
      threadId,
      types: ["client/turn/requested"],
      order: "desc",
      limit: "1",
    });
    const context = JSON.stringify({
      title: thread.title,
      latestUserRequest: previousUser[0] ?? null,
      assistant: output,
      pendingQuestion: interaction?.payload ?? null,
    });
    if (context.length > 20_000) return null;
    const requestKey = interaction
      ? `interaction:${interaction.id}`
      : `idle:${thread.latestAttentionAt}:${createHash("sha256").update(context).digest("hex")}`;
    return {
      threadId,
      requestKey,
      interactionId: interaction?.id ?? null,
      context,
    };
  }

  async function current(item: QuickDecision) {
    const thread = await bb.sdk.threads.get({ threadId: item.threadId });
    if (!eligible(thread) || !(await inOpenThread(thread))) return false;
    if (item.interactionId !== null) {
      const interaction = await bb.sdk.threads.interactions.get({
        threadId: item.threadId,
        interactionId: item.interactionId,
      });
      return interaction.status === "pending";
    }
    return (
      thread.status === "idle" &&
      item.requestKey.startsWith(`idle:${thread.latestAttentionAt}:`)
    );
  }

  async function analyze(
    threadId: string,
    assistantText?: string | null,
    force = false,
  ) {
    if (disposed || !(await preferences.read("quickDecisions"))) return;
    const version = versions.get(threadId) ?? 0;
    const source = await request(threadId, assistantText);
    if (disposed || version !== (versions.get(threadId) ?? 0)) return;
    if (!source) {
      clear(threadId);
      return;
    }
    const existing = get(threadId);
    if (!force && existing?.requestKey === source.requestKey) return;
    const active = working.get(threadId);
    if (active?.key === source.requestKey) return active.done;
    active?.controller.abort();
    const controller = new AbortController();
    const item: QuickDecision = {
      threadId,
      requestKey: source.requestKey,
      interactionId: source.interactionId,
      level: "normal",
      reason: "",
      classifiedAt: Date.now(),
    };
    put(item);
    if (existing && existing.level !== "normal") publish();
    const done = inference.then(async () => {
      if (disposed || controller.signal.aborted) return;
      try {
        const result = await bb.sdk.plugins.callRpc({
          pluginId: "provider-codex",
          method: "ai.complete",
          input: { prompt: decisionPrompt(source.context) },
          outputSchema: completionSchema,
          signal: controller.signal,
        });
        const answer = decisionResultSchema.parse(JSON.parse(result.text));
        if (
          disposed ||
          controller.signal.aborted ||
          version !== (versions.get(threadId) ?? 0) ||
          !(await preferences.read("quickDecisions"))
        )
          return;
        const valid = await current(item);
        if (
          disposed ||
          controller.signal.aborted ||
          version !== (versions.get(threadId) ?? 0)
        )
          return;
        if (!valid) {
          clear(threadId);
          return;
        }
        put({ ...item, ...answer });
        publish();
      } catch (error) {
        if (!disposed && !controller.signal.aborted)
          bb.log.debug(
            `Quick-decision classification unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
      } finally {
        if (working.get(threadId)?.controller === controller)
          working.delete(threadId);
      }
    });
    working.set(threadId, { key: source.requestKey, controller, done });
    inference = done.catch(() => {});
    await done;
  }

  async function reconcile(threadId: string) {
    const item = get(threadId);
    if (!item) return;
    const version = versions.get(threadId) ?? 0;
    const unchanged = () =>
      !disposed &&
      version === (versions.get(threadId) ?? 0) &&
      get(threadId)?.requestKey === item.requestKey;
    try {
      const valid = await current(item);
      if (unchanged() && !valid) clear(threadId);
    } catch {
      if (unchanged()) clear(threadId);
    }
  }

  async function snapshot(): Promise<QuickDecisionsState> {
    if (!(await preferences.read("quickDecisions"))) return { items: [] };
    await Promise.all(rows().map((item) => reconcile(item.threadId)));
    return { items: rows() };
  }

  bb.events.on("thread.idle", ({ thread, lastAssistantText }) =>
    lastAssistantText === null
      ? reconcile(thread.id)
      : analyze(thread.id, lastAssistantText),
  );
  bb.events.on("interaction.pending", ({ thread }) => analyze(thread.id));
  bb.events.on("experimental_thread.events", ({ thread }) =>
    reconcile(thread.id),
  );
  bb.events.on("thread.active", ({ thread }) => clear(thread.id));
  bb.events.on("thread.failed", ({ thread }) => clear(thread.id));
  bb.events.on("thread.archived", ({ thread }) => clear(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => clear(thread.id));
  bb.events.on("message.dispatched", ({ entry }) => clear(entry.threadId));
  bb.onDispose(() => {
    disposed = true;
    for (const work of working.values()) work.controller.abort();
    working.clear();
  });
  return { analyze, clear, snapshot };
}

export function decisionCommands(
  policy: ReturnType<typeof createDecisionPolicy>,
) {
  const options = {
    json: { type: "boolean", description: "Emit machine-readable JSON" },
  } as const;
  return {
    "decisions list": cliCommand({
      summary: "List outstanding quick decisions in the sidebar",
      options,
      async run(input) {
        const state = await policy.snapshot();
        return {
          exitCode: 0,
          stdout: input.options.json
            ? JSON.stringify(state)
            : state.items
                .map(
                  (item) => `${item.threadId}\t${item.level}\t${item.reason}`,
                )
                .join("\n") || "No quick decisions waiting.",
        };
      },
    }),
    "decisions refresh": cliCommand({
      summary:
        "Classify the current decision in a thread using the existing Codex login",
      positionals: [
        { name: "thread-id", description: "Thread id", required: true },
      ],
      options,
      async run(input) {
        await policy.analyze(input.positionals["thread-id"], undefined, true);
        const state = await policy.snapshot();
        return {
          exitCode: 0,
          stdout: input.options.json
            ? JSON.stringify(state)
            : state.items
                .filter(
                  (item) => item.threadId === input.positionals["thread-id"],
                )
                .map((item) => `${item.level}\t${item.reason}`)
                .join("\n") || "No quick decision identified.",
        };
      },
    }),
  };
}
