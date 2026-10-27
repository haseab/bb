import { appendFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { CodexSessionReader } from "./session-reader.js";
import { experimental_nativeSessionSnapshotSchema as nativeSessionSnapshotSchema } from "@get-bb/plugin-sdk/provider-bridge";
import type { CodexAppServerConnection } from "./bridge/app-server-connection.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Codex session history reader", () => {
  it("reads paginated history without resuming, preserves images and unknown tools, and follows active turn records", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "codex-session-reader-"));
    temporaryDirectories.push(home);
    vi.stubEnv("CODEX_HOME", home);
    await mkdir(path.join(home, "sessions"));
    const rollout = path.join(home, "sessions", "thread.jsonl");
    await writeFile(
      rollout,
      JSON.stringify({
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-native" },
      }) + "\n",
    );
    const calls: string[] = [];
    let killed = false;
    const connection: CodexAppServerConnection = {
      exited: false,
      async kill() {
        killed = true;
      },
      async request<T>(args: {
        method: string;
        params?: unknown;
        resultSchema: z.ZodType<T>;
      }) {
        calls.push(args.method);
        let result: unknown = {};
        if (args.method === "thread/read")
          result = {
            thread: {
              id: "thread-native",
              name: "Shared conversation",
              cwd: "/project",
              preview: "Preview",
              createdAt: 10,
              updatedAt: 20,
              path: rollout,
            },
          };
        if (args.method === "thread/turns/list")
          result = {
            data: [
              {
                id: "turn-native",
                status: "interrupted",
                error: null,
                startedAt: 12,
                items: [
                  {
                    type: "userMessage",
                    id: "user-native",
                    content: [
                      { type: "text", text: "Review this" },
                      { type: "image", url: "data:image/png;base64,AA==" },
                    ],
                  },
                  {
                    type: "agentMessage",
                    id: "answer-native",
                    text: "Working on it",
                  },
                  {
                    type: "futureTool",
                    id: "unknown-native",
                    output: "Not understood yet",
                  },
                ],
              },
            ],
            nextCursor: "older",
          };
        if (args.method === "thread/list")
          result = { data: [], nextCursor: null };
        return args.resultSchema.parse(result);
      },
    };
    const reader = new CodexSessionReader(() => connection);
    try {
      const first = await reader.read({
        threadId: "thread-native",
        cursor: null,
      });
      expect(first.session.active).toBe(true);
      expect(first.session.turns[0]?.userMessages[0]?.content).toHaveLength(2);
      expect(
        first.session.turns[0]?.deltas.some(
          (delta) => delta.kind === "item.close",
        ),
      ).toBe(true);
      expect(
        first.session.turns[0]?.deltas.some(
          (delta) => delta.kind === "unhandled",
        ),
      ).toBe(true);
      expect(
        first.session.turns[0]?.deltas.some(
          (delta) => delta.kind === "turn.boundary",
        ),
      ).toBe(false);
      expect(first.nextCursor).toBe("older");
      expect(() =>
        nativeSessionSnapshotSchema.parse({ ...first.session, hostId: "host" }),
      ).not.toThrow();
      await appendFile(
        rollout,
        JSON.stringify({
          type: "event_msg",
          payload: { type: "task_complete", turn_id: "turn-native" },
        }) + "\n",
      );
      const second = await reader.read({
        threadId: "thread-native",
        cursor: "older",
      });
      expect(second.session.active).toBe(false);
      expect(
        second.session.turns[0]?.deltas.some(
          (delta) => delta.kind === "turn.boundary",
        ),
      ).toBe(true);
      expect(calls).not.toContain("thread/resume");
      expect(calls.filter((method) => method === "initialize")).toHaveLength(1);
    } finally {
      await reader.dispose();
    }
    expect(killed).toBe(true);
  });
});
