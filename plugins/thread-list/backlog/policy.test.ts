import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";
import type { BacklogState } from "../shared/backlog.js";

const now = Date.parse("2026-11-04T20:00:00Z");
const day = 86_400_000;
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
async function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const host = createFakePluginHost({
    pluginId: "thread-list",
    sdk: {
      system: { uiPreferences: { list: async () => ({ preferences: {} }) } },
    },
  });
  hosts.push(host);
  const threads = new Map(
    [
      makeThreadResponse({ id: "backlog", sectionId: "backlog-section" }),
      makeThreadResponse({ id: "hot", sectionId: null }),
    ].map((thread) => [thread.id, thread]),
  );
  const stubSdk = (target: typeof host) => {
    target.harness.sdk.stub("threadSections.list", async () => [
      { id: "backlog-section", name: "Backlog", createdAt: 1, updatedAt: 1 },
    ]);
    target.harness.sdk.stub("threads.get", async ({ threadId }) => {
      const thread = threads.get(threadId);
      if (!thread) throw new Error("missing thread");
      return thread;
    });
    target.harness.sdk.stub("threads.list", async (args) =>
      [...threads.values()]
        .filter(
          (thread) =>
            thread.archivedAt === null &&
            (args?.sectionId === undefined ||
              thread.sectionId === args.sectionId) &&
            (args?.threadIds === undefined ||
              args.threadIds.includes(thread.id)),
        )
        .slice(args?.offset ?? 0, (args?.offset ?? 0) + (args?.limit ?? 200)),
    );
    target.harness.sdk.stub(
      "threads.update",
      async ({ threadId, ...update }) => {
        const old = threads.get(threadId);
        if (!old) throw new Error("missing thread");
        const next = { ...old, ...update };
        threads.set(threadId, next);
        return { ok: true };
      },
    );
    target.harness.sdk.stub("threads.unpin", async ({ threadId }) => {
      const old = threads.get(threadId);
      if (!old) throw new Error("missing thread");
      threads.set(threadId, { ...old, pinnedAt: null });
      return { ok: true };
    });
  };
  stubSdk(host);
  await plugin(host.bb);
  const state = async () =>
    host.harness.behavior.callRpc<BacklogState>("backlogState", null);
  return { ...host, threads, state, stubSdk };
}
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
  vi.useRealTimers();
});

describe("durable Backlog refresh policy", () => {
  it("gives existing and newly backlogged threads a seven-day implicit deadline and appends due work below hot work", async () => {
    const host = await setup();
    expect(await host.state()).toMatchObject({
      sectionId: "backlog-section",
      items: [
        {
          threadId: "backlog",
          followUpAt: null,
          refreshAt: now + 7 * day,
          stage: "backlog",
        },
      ],
    });
    await host.harness.behavior.callRpc("setPreference", {
      key: "manualThreadOrder",
      value: ["hot", "backlog"],
    });
    vi.setSystemTime(now + 7 * day - 1);
    await host.state();
    expect(host.threads.get("backlog")?.sectionId).toBe("backlog-section");
    vi.setSystemTime(now + 7 * day);
    await host.harness.behavior.runSchedule("backlog-refresh");
    expect(await host.state()).toMatchObject({
      items: [
        { threadId: "backlog", stage: "refreshed", refreshedAt: now + 7 * day },
      ],
    });
    expect(host.threads.get("backlog")?.sectionId).toBeNull();
    expect(
      await host.bb.storage.kv.get("preference:manualThreadOrder"),
    ).toEqual(["hot", "backlog"]);
    const calls = host.harness.sdk.callsTo("threads.update").length;
    await host.state();
    expect(host.harness.sdk.callsTo("threads.update")).toHaveLength(calls);
    const hot = host.threads.get("hot")!;
    host.threads.set("hot", { ...hot, sectionId: "backlog-section" });
    expect(
      (await host.state()).items.find((item) => item.threadId === "hot")
        ?.refreshAt,
    ).toBe(now + 14 * day);
  });
  it("explicit dates override the default, persist across reload, and return a queued thread to Backlog", async () => {
    const host = await setup();
    await host.state();
    const scheduled = await host.harness.behavior.callRpc<BacklogState>(
      "scheduleFollowUp",
      { threadId: "hot", input: "61 min", timeZone: "America/Los_Angeles" },
    );
    expect(
      scheduled.items.find((item) => item.threadId === "hot"),
    ).toMatchObject({
      followUpAt: now + 61 * 60_000,
      refreshAt: now + 61 * 60_000,
    });
    expect(host.threads.get("hot")?.sectionId).toBe("backlog-section");
    const replacement = await host.harness.lifecycle.reload(plugin);
    hosts.push(replacement);
    host.stubSdk(replacement);
    vi.setSystemTime(now + 61 * 60_000);
    const restored = await replacement.harness.behavior.callRpc<BacklogState>(
      "backlogState",
      null,
    );
    expect(restored.items.find((item) => item.threadId === "hot")?.stage).toBe(
      "refreshed",
    );
  });
  it("respects manual moves, archives, and pins before a deadline", async () => {
    const host = await setup();
    await host.state();
    const thread = host.threads.get("backlog")!;
    host.threads.set("backlog", { ...thread, sectionId: "elsewhere" });
    vi.setSystemTime(now + 8 * day);
    expect((await host.state()).items).toEqual([]);
    expect(host.harness.sdk.callsTo("threads.update")).toEqual([]);
  });
  it("does not refresh a running thread, and checks current placement again before moving it", async () => {
    const host = await setup();
    await host.state();
    const thread = host.threads.get("backlog")!;
    host.threads.set("backlog", { ...thread, status: "active" });
    vi.setSystemTime(now + 8 * day);
    await host.state();
    expect(host.harness.sdk.callsTo("threads.update")).toEqual([]);
    host.threads.set("backlog", { ...thread, status: "idle" });
    host.harness.sdk.stub("threads.get", async () => ({
      ...thread,
      sectionId: "manual-move",
    }));
    await host.state();
    expect(host.harness.sdk.callsTo("threads.update")).toEqual([]);
  });
  it("marks a refreshed thread hot when it runs and does not auto-start refreshed threads", async () => {
    const host = await setup();
    await host.state();
    vi.setSystemTime(now + 7 * day);
    await host.state();
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
    const thread = host.threads.get("backlog")!;
    const active = { ...thread, status: "active" as const };
    host.threads.set("backlog", active);
    await host.harness.behavior.emitThreadEvent("thread.active", {
      thread: active,
    });
    expect((await host.state()).items).toEqual([]);
    expect(
      await host.bb.storage.kv.get("preference:manualThreadOrder"),
    ).toEqual(["backlog"]);
  });
  it("recovers a partially completed refresh without duplicates", async () => {
    const host = await setup();
    await host.state();
    vi.setSystemTime(now + 7 * day);
    const spy = vi
      .spyOn(host.bb.storage.kv, "set")
      .mockImplementationOnce(async () => {
        throw new Error("offline");
      });
    await expect(host.state()).rejects.toThrow("offline");
    spy.mockRestore();
    expect(host.threads.get("backlog")?.sectionId).toBeNull();
    expect((await host.state()).items[0].stage).toBe("refreshed");
    expect(
      await host.bb.storage.kv.get("preference:manualThreadOrder"),
    ).toEqual(["backlog"]);
  });
  it("exposes scheduling and clearing through the CLI and refuses stale Backlog-only triage", async () => {
    const host = await setup();
    const listed = await host.harness.behavior.runCli([
      "backlog",
      "list",
      "--json",
    ]);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      sectionId: "backlog-section",
    });
    const scheduled = await host.harness.behavior.runCli([
      "backlog",
      "schedule",
      "hot",
      "61 min",
      "--timezone",
      "America/Los_Angeles",
      "--json",
    ]);
    expect(scheduled.exitCode).toBe(0);
    expect(
      JSON.parse(scheduled.stdout).items.find(
        (item: { threadId: string }) => item.threadId === "hot",
      ).followUpAt,
    ).toBe(now + 61 * 60_000);
    const cleared = await host.harness.behavior.runCli([
      "backlog",
      "clear",
      "hot",
      "--json",
    ]);
    expect(cleared.exitCode).toBe(0);
    expect(
      JSON.parse(cleared.stdout).items.find(
        (item: { threadId: string }) => item.threadId === "hot",
      ).followUpAt,
    ).toBeNull();
    const thread = host.threads.get("hot")!;
    host.threads.set("hot", { ...thread, sectionId: null });
    await expect(
      host.harness.behavior.callRpc("scheduleFollowUp", {
        threadId: "hot",
        input: "7d",
        timeZone: "UTC",
        onlyBacklog: true,
      }),
    ).rejects.toThrow("no longer in Backlog");
    expect(host.threads.get("hot")?.sectionId).toBeNull();
  });

  it.each(["pin", "archive", "delete"] as const)(
    "does not refresh a thread after %s",
    async (action) => {
      const host = await setup();
      await host.state();
      const thread = host.threads.get("backlog")!;
      if (action === "delete") host.threads.delete("backlog");
      else
        host.threads.set("backlog", {
          ...thread,
          ...(action === "pin" ? { pinnedAt: now } : { archivedAt: now }),
        });
      vi.setSystemTime(now + 8 * day);
      expect((await host.state()).items).toEqual([]);
      expect(host.harness.sdk.callsTo("threads.update")).toEqual([]);
    },
  );

  it("rejects bad dates and clears explicit dates back to the default policy", async () => {
    const host = await setup();
    await host.state();
    await expect(
      host.harness.behavior.callRpc("scheduleFollowUp", {
        threadId: "backlog",
        input: "yesterday",
        timeZone: "UTC",
      }),
    ).rejects.toThrow();
    await host.harness.behavior.callRpc("scheduleFollowUp", {
      threadId: "backlog",
      input: "61 min",
      timeZone: "UTC",
    });
    const result = await host.harness.behavior.callRpc<BacklogState>(
      "clearFollowUp",
      { threadId: "backlog" },
    );
    expect(result.items[0]).toMatchObject({
      followUpAt: null,
      refreshAt: now + 7 * day,
    });
  });
});
