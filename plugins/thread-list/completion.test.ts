import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.js";

const completedSection = {
  id: "sec_completed",
  name: "Completed",
  createdAt: 1,
  updatedAt: 1,
};

function setup(
  overrides: Parameters<typeof makeThreadResponse>[0] = {},
  existing = false,
) {
  let thread = makeThreadResponse({ id: "thr_task", ...overrides });
  const sections = existing ? [completedSection] : [];
  const host = createFakePluginHost({
    pluginId: "thread-list",
    sdk: {
      system: { uiPreferences: { list: async () => ({ preferences: {} }) } },
      threads: {
        get: async () => thread,
        update: async (input) => {
          thread = { ...thread, ...input };
          return { ok: true };
        },
        unpin: async () => {
          thread = { ...thread, pinnedAt: null };
          return { ok: true };
        },
      },
      threadSections: {
        list: async () => [...sections],
        create: async () => {
          sections.push(completedSection);
          return completedSection;
        },
      },
    },
  });
  return { ...host, current: () => thread };
}

for (const surface of ["rpc", "cli"] as const) {
  describe(`thread completion through ${surface}`, () => {
    const run = async (host: ReturnType<typeof setup>, completed: boolean) => {
      if (surface === "rpc")
        return host.harness.behavior.callRpc("setCompleted", {
          threadId: "thr_task",
          completed,
        });
      const result = await host.harness.behavior.runCli([
        completed ? "complete" : "reopen",
        "thr_task",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      return JSON.parse(result.stdout);
    };

    it("completes a pinned child, preserves runtime and archive state, and reopens to the queue", async () => {
      const host = setup({
        pinnedAt: 1,
        parentThreadId: "thr_parent",
        status: "active",
      });
      await plugin(host.bb);
      expect(await run(host, true)).toEqual({
        threadId: "thr_task",
        sectionId: "sec_completed",
      });
      expect(host.current()).toMatchObject({
        sectionId: "sec_completed",
        parentThreadId: null,
        pinnedAt: null,
        status: "active",
        archivedAt: null,
      });
      expect(host.harness.inspection.sdk.callsTo("threads.archive")).toEqual(
        [],
      );
      await run(host, true);
      expect(
        host.harness.inspection.sdk.callsTo("threadSections.create"),
      ).toHaveLength(1);
      expect(
        host.harness.inspection.sdk.callsTo("threads.update"),
      ).toHaveLength(1);
      await run(host, false);
      expect(host.current()).toMatchObject({
        sectionId: null,
        archivedAt: null,
      });
    });

    it("adopts an existing Completed section without creating duplicates", async () => {
      const host = setup({}, true);
      await plugin(host.bb);
      await run(host, true);
      expect(
        host.harness.inspection.sdk.callsTo("threadSections.create"),
      ).toEqual([]);
      expect(
        await host.bb.storage.kv.get("preference:completedSectionId"),
      ).toBe("sec_completed");
    });

    it("does not move a thread already reopened into another section", async () => {
      const host = setup({ sectionId: "sec_other" }, true);
      await plugin(host.bb);
      await host.bb.storage.kv.set(
        "preference:completedSectionId",
        "sec_completed",
      );
      await run(host, false);
      expect(host.harness.inspection.sdk.callsTo("threads.update")).toEqual([]);
    });
  });
}

describe("completion boundaries", () => {
  it.each([{ archivedAt: 1 }, { deletedAt: 1 }])(
    "rejects unavailable threads: %j",
    async (state) => {
      const host = setup(state);
      await plugin(host.bb);
      await expect(
        host.harness.behavior.callRpc("setCompleted", {
          threadId: "thr_task",
          completed: true,
        }),
      ).rejects.toThrow(/Unarchive/);
      expect(
        host.harness.inspection.sdk.callsTo("threadSections.create"),
      ).toEqual([]);
      expect(host.harness.inspection.sdk.callsTo("threads.update")).toEqual([]);
    },
  );

  it("serializes concurrent completions and recreates a removed destination", async () => {
    const host = setup();
    await plugin(host.bb);
    await host.bb.storage.kv.set(
      "preference:completedSectionId",
      "sec_deleted",
    );
    await Promise.all(
      [1, 2, 3].map(() =>
        host.harness.behavior.callRpc("setCompleted", {
          threadId: "thr_task",
          completed: true,
        }),
      ),
    );
    expect(
      host.harness.inspection.sdk.callsTo("threadSections.create"),
    ).toHaveLength(1);
    expect(host.harness.inspection.sdk.callsTo("threads.update")).toHaveLength(
      1,
    );
  });
});
