import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { createPreferenceStore } from "../server.js";
import { createDecisionPolicy } from "./policy.js";

const hosts: ReturnType<typeof createFakePluginHost>[] = [];
function setup(
  answer: () => Promise<string> = async () =>
    JSON.stringify({
      level: "instant",
      reason: "Pick one of two export formats",
    }),
) {
  const host = createFakePluginHost({ pluginId: "thread-list" });
  hosts.push(host);
  let thread = makeThreadResponse({
    id: "thread-1",
    status: "idle",
    latestAttentionAt: 10,
  });
  let output =
    "Which export format do you prefer: CSV or Excel? Both have the same fields.";
  const complete = vi.fn(async () => ({ text: await answer() }));
  host.harness.sdk.stub("threads.get", async () => thread);
  host.harness.sdk.stub("threads.interactions.list", async () => []);
  host.harness.sdk.stub("threads.events.list", async () => []);
  host.harness.sdk.stub("threads.output", async () => ({ output }));
  host.harness.sdk.stub("plugins.callRpc", complete);
  const policy = createDecisionPolicy(host.bb, createPreferenceStore(host.bb));
  return {
    ...host,
    policy,
    complete,
    get thread() {
      return thread;
    },
    set thread(value: typeof thread) {
      thread = value;
    },
    get output() {
      return output;
    },
    set output(value: string) {
      output = value;
    },
  };
}
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});

describe("quick-decision lifecycle", () => {
  it("caches one classification per request and retains it after reading", async () => {
    const host = setup();
    await host.policy.analyze(host.thread.id);
    host.thread = { ...host.thread, lastReadAt: 20, updatedAt: 20 };
    await host.policy.analyze(host.thread.id);
    expect(host.complete).toHaveBeenCalledTimes(1);
    expect((await host.policy.snapshot()).items).toMatchObject([
      { threadId: host.thread.id, level: "instant" },
    ]);
    expect(host.harness.sdk.callsTo("threads.update")).toHaveLength(0);
  });
  it("cannot restore a dot after a new turn invalidates an in-flight result", async () => {
    let finish!: (value: string) => void;
    const host = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = host.policy.analyze(host.thread.id);
    await vi.waitFor(() => expect(host.complete).toHaveBeenCalledTimes(1));
    host.thread = { ...host.thread, status: "active" };
    await host.harness.behavior.emitThreadEvent("thread.active", {
      thread: host.thread,
    });
    finish(JSON.stringify({ level: "instant", reason: "Old question" }));
    await pending;
    expect((await host.policy.snapshot()).items).toEqual([]);
  });
  it("cannot restore a dot when a reply arrives during final request validation", async () => {
    const host = setup();
    const old = host.thread;
    let reads = 0;
    let finish!: () => void;
    host.harness.sdk.stub("threads.get", async () => {
      if (++reads === 2)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return old;
    });
    const pending = host.policy.analyze(old.id);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    host.thread = { ...old, status: "active" };
    await host.harness.behavior.emitThreadEvent("thread.active", {
      thread: host.thread,
    });
    finish();
    await pending;
    expect((await host.policy.snapshot()).items).toEqual([]);
  });
  it("drops resolved structured questions even when the thread remains active", async () => {
    const host = setup();
    host.thread = { ...host.thread, status: "active" };
    let interaction: Awaited<
      ReturnType<typeof host.bb.sdk.threads.interactions.get>
    > = {
      id: "question-1",
      threadId: host.thread.id,
      turnId: "turn-1",
      providerId: "codex",
      providerThreadId: "codex-1",
      providerRequestId: "request-1",
      status: "pending",
      statusReason: null,
      createdAt: 1,
      resolvedAt: null,
      resolution: null,
      payload: {
        kind: "user_question",
        questions: [
          {
            id: "format",
            prompt: "CSV or Excel?",
            multiSelect: false,
            allowFreeText: true,
            options: [
              { value: "csv", label: "CSV" },
              { value: "excel", label: "Excel" },
            ],
          },
        ],
      },
    };
    host.harness.sdk.stub("threads.interactions.list", async () =>
      interaction.status === "pending" ? [interaction] : [],
    );
    host.harness.sdk.stub("threads.interactions.get", async () => interaction);
    await host.policy.analyze(host.thread.id);
    expect((await host.policy.snapshot()).items).toHaveLength(1);
    interaction = { ...interaction, status: "resolved" };
    await host.harness.behavior.emitThreadEvent("experimental_thread.events", {
      thread: host.thread,
      sequence: 5,
    });
    expect((await host.policy.snapshot()).items).toEqual([]);
  });
  it.each([
    "not JSON",
    '{"level":"instant","reason":"ok","extra":true}',
    '{"level":"urgent","reason":"ok"}',
  ])(
    "leaves the queue ordinary for malformed model output: %s",
    async (answer) => {
      const host = setup(async () => answer);
      await host.policy.analyze(host.thread.id);
      await host.policy.analyze(host.thread.id);
      expect((await host.policy.snapshot()).items).toEqual([]);
      expect(host.complete).toHaveBeenCalledTimes(1);
    },
  );
  it("leaves the queue ordinary when Codex is unavailable, and supports explicit retry", async () => {
    const host = setup(async () => {
      throw new Error("Sign in to Codex");
    });
    await host.policy.analyze(host.thread.id);
    await host.policy.analyze(host.thread.id);
    expect(host.complete).toHaveBeenCalledTimes(1);
    expect((await host.policy.snapshot()).items).toEqual([]);
    await host.policy.analyze(host.thread.id, undefined, true);
    expect(host.complete).toHaveBeenCalledTimes(2);
  });
  it("skips disabled, completed, oversized, and already-running requests", async () => {
    const host = setup();
    await host.bb.storage.kv.set("preference:quickDecisions", false);
    await host.policy.analyze(host.thread.id);
    await host.bb.storage.kv.set("preference:quickDecisions", true);
    host.thread = { ...host.thread, status: "active" };
    await host.policy.analyze(host.thread.id);
    host.thread = { ...host.thread, status: "idle", sectionId: "completed" };
    await host.bb.storage.kv.set("preference:completedSectionId", "completed");
    await host.policy.analyze(host.thread.id);
    host.thread = { ...host.thread, sectionId: null };
    host.output = "x".repeat(21_000);
    await host.policy.analyze(host.thread.id);
    expect(host.complete).not.toHaveBeenCalled();
  });
  it("expires a blocked child's dot when its parent moves to Completed", async () => {
    const host = setup();
    const parent = makeThreadResponse({ id: "parent", status: "idle" });
    host.thread = { ...host.thread, parentThreadId: parent.id };
    host.harness.sdk.stub("threads.get", async ({ threadId }) =>
      threadId === parent.id ? parent : host.thread,
    );
    await host.policy.analyze(host.thread.id);
    expect((await host.policy.snapshot()).items).toHaveLength(1);
    await host.bb.storage.kv.set("preference:completedSectionId", "completed");
    parent.sectionId = "completed";
    expect((await host.policy.snapshot()).items).toEqual([]);
  });
  it("reclassifies a new request and expires stale results on reload", async () => {
    const host = setup();
    await host.policy.analyze(host.thread.id);
    const reopened = createDecisionPolicy(
      host.bb,
      createPreferenceStore(host.bb),
    );
    expect((await reopened.snapshot()).items).toHaveLength(1);
    host.thread = { ...host.thread, latestAttentionAt: 30 };
    expect((await reopened.snapshot()).items).toEqual([]);
    await reopened.analyze(host.thread.id);
    expect(host.complete).toHaveBeenCalledTimes(2);
  });
});
