import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, { migrateFromUiPreferences } from "./server.js";
import { defaultPreferences } from "./shared/preferences.js";

const PLUGIN_ID = "thread-list";

function setup(
  options: {
    uiPreferences?: Record<string, { revision: number; value: unknown }>;
    uiPreferencesFail?: boolean;
  } = {},
) {
  return createFakePluginHost({
    pluginId: PLUGIN_ID,
    sdk: {
      system: {
        uiPreferences: {
          list: async () => {
            if (options.uiPreferencesFail) throw new Error("offline");
            return { preferences: options.uiPreferences ?? {} };
          },
        },
      },
    },
  });
}

describe("thread-list preferences rpc", () => {
  it("lists defaults on a fresh install and round-trips a valid write", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("listPreferences", null),
    ).resolves.toEqual({
      preferences: defaultPreferences(),
    });
    await expect(
      harness.behavior.callRpc("listPreferences", null),
    ).resolves.toMatchObject({
      preferences: { showProviderIcons: true },
    });
    await harness.behavior.callRpc("setPreference", {
      key: "showProviderIcons",
      value: false,
    });
    await migrateFromUiPreferences(bb);
    await expect(
      harness.behavior.callRpc("listPreferences", null),
    ).resolves.toMatchObject({
      preferences: { showProviderIcons: false },
    });

    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "organizationMode",
        value: "machine",
      }),
    ).resolves.toEqual({ key: "organizationMode", value: "machine" });
    await expect(
      bb.storage.kv.get("preference:organizationMode"),
    ).resolves.toBe("machine");
    const listed = (await harness.behavior.callRpc(
      "listPreferences",
      null,
    )) as {
      preferences: { organizationMode: string };
    };
    expect(listed.preferences.organizationMode).toBe("machine");
    expect(harness.realtimeSignals).toEqual([
      {
        channel: "preferences",
        payload: { key: "showProviderIcons", value: false },
      },
      {
        channel: "preferences",
        payload: { key: "organizationMode", value: "machine" },
      },
    ]);
  });

  it("rejects a value that fails the preference's schema and leaves storage alone", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "organizationMode",
        value: "sideways",
      }),
    ).rejects.toThrow(/Invalid value for organizationMode/);
    await expect(
      bb.storage.kv.get("preference:organizationMode"),
    ).resolves.toBeUndefined();
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "hiddenGroups",
        value: ["project:a", "bogus"],
      }),
    ).rejects.toThrow(/Invalid value for hiddenGroups/);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "showProviderIcons",
        value: "false",
      }),
    ).rejects.toThrow(/Invalid value for showProviderIcons/);
  });

  it("dedupes hidden groups and resets to the default", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "hiddenGroups",
        value: ["threads", "project:a", "project:a", "machine:m"],
      }),
    ).resolves.toEqual({
      key: "hiddenGroups",
      value: ["threads", "project:a", "machine:m"],
    });
    await expect(
      harness.behavior.callRpc("resetPreference", { key: "hiddenGroups" }),
    ).resolves.toEqual({ key: "hiddenGroups", value: [] });
    await expect(
      bb.storage.kv.get("preference:hiddenGroups"),
    ).resolves.toBeUndefined();
  });

  it("defaults row actions to complete, migrates bare ids, dedupes them, and rejects malformed or too many keys", async () => {
    const { bb, harness } = setup();
    await plugin(bb);
    const listed = (await harness.behavior.callRpc(
      "listPreferences",
      null,
    )) as {
      preferences: { rowActions: string[] };
    };
    expect(listed.preferences.rowActions).toEqual(["thread-list/complete"]);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["pin", "core/archive", "bb--core/pin"],
      }),
    ).resolves.toEqual({
      key: "rowActions",
      value: ["bb--core/pin", "bb--core/archive"],
    });
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["move", "push-notifications/level"],
      }),
    ).resolves.toEqual({
      key: "rowActions",
      value: ["thread-list/move", "push-notifications/level"],
    });
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["archive", "delete"],
      }),
    ).rejects.toThrow(/Invalid value for rowActions/);
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "rowActions",
        value: ["archive", "pin", "read", "rename"],
      }),
    ).rejects.toThrow(/at most 3 row actions/);
  });

  it("migrates stored bare ids and core/<id> keys and drops unknown ones instead of resetting the rest", async () => {
    const { bb, harness } = setup();
    await bb.storage.kv.set("preference:rowActions", [
      "pin",
      "futureAction",
      "move",
      "core/rename",
    ]);
    await plugin(bb);
    const listed = (await harness.behavior.callRpc(
      "listPreferences",
      null,
    )) as {
      preferences: { rowActions: string[] };
    };
    expect(listed.preferences.rowActions).toEqual([
      "bb--core/pin",
      "thread-list/move",
      "bb--core/rename",
    ]);
  });

  it("falls back to the default when a stored value no longer parses", async () => {
    const { bb, harness } = setup();
    await bb.storage.kv.set("preference:chronologicalSort", "by-vibes");
    await plugin(bb);
    const listed = (await harness.behavior.callRpc(
      "listPreferences",
      null,
    )) as {
      preferences: { chronologicalSort: string };
    };
    expect(listed.preferences.chronologicalSort).toBe("updated");
  });
});

describe("migration from bb's sidebar preferences", () => {
  it("copies non-default values once and never overwrites a value the plugin already has", async () => {
    const { bb } = setup({
      uiPreferences: {
        "sidebar.organizationMode": { revision: 3, value: "machine" },
        "sidebar.sectionOrder": { revision: 1, value: ["proj_a"] },
        "sidebar.chronologicalSort": { revision: 0, value: "updated" },
        "sidebar.hiddenGroups": { revision: 2, value: ["not-a-group"] },
      },
    });
    await bb.storage.kv.set("preference:sectionOrder", ["proj_mine"]);
    const first = await migrateFromUiPreferences(bb);
    expect(first.migrated).toEqual(["organizationMode"]);
    await expect(
      bb.storage.kv.get("preference:organizationMode"),
    ).resolves.toBe("machine");
    await expect(bb.storage.kv.get("preference:sectionOrder")).resolves.toEqual(
      ["proj_mine"],
    );
    await expect(
      bb.storage.kv.get("preference:chronologicalSort"),
    ).resolves.toBeUndefined();
    await expect(
      bb.storage.kv.get("preference:hiddenGroups"),
    ).resolves.toBeUndefined();

    await bb.storage.kv.delete("preference:organizationMode");
    const second = await migrateFromUiPreferences(bb);
    expect(second.migrated).toEqual([]);
    await expect(
      bb.storage.kv.get("preference:organizationMode"),
    ).resolves.toBeUndefined();
  });

  it("skips the migration without marking it done when bb cannot be read", async () => {
    const { bb } = setup({ uiPreferencesFail: true });
    expect((await migrateFromUiPreferences(bb)).migrated).toEqual([]);
    await expect(
      bb.storage.kv.get("migration:ui-preferences:v1"),
    ).resolves.toBeUndefined();
  });
});

describe("bb thread-list prefs", () => {
  it("names the CLI after the plugin id", async () => {
    const builtIn = setup();
    await plugin(builtIn.bb);
    expect(builtIn.harness.inspection.registrations.cli?.name).toBe(
      "thread-list",
    );

    const copy = createFakePluginHost({ pluginId: "my-sidebar" });
    await plugin(copy.bb);
    expect(copy.harness.inspection.registrations.cli?.name).toBe("my-sidebar");
  });

  it("lists, gets, sets, and resets through the CLI", async () => {
    const { bb, harness } = setup();
    await plugin(bb);

    const listed = await harness.behavior.runCli(["prefs", "list", "--json"]);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual(defaultPreferences());

    const set = await harness.behavior.runCli([
      "prefs",
      "set",
      "manualSectionOrder",
      '["threads","pinned","sections"]',
    ]);
    expect(set.exitCode).toBe(0);
    expect(set.stdout).toBe(
      'manualSectionOrder = ["threads","pinned","sections"]',
    );

    const bare = await harness.behavior.runCli([
      "prefs",
      "set",
      "organizationMode",
      "project",
    ]);
    expect(bare.exitCode).toBe(0);

    const got = await harness.behavior.runCli([
      "prefs",
      "get",
      "organizationMode",
    ]);
    expect(got.stdout).toBe('"project"');

    const iconsOn = await harness.behavior.runCli([
      "prefs",
      "set",
      "showProviderIcons",
      "true",
    ]);
    expect(iconsOn.exitCode).toBe(0);
    expect(iconsOn.stdout).toBe("showProviderIcons = true");
    await expect(
      bb.storage.kv.get("preference:showProviderIcons"),
    ).resolves.toBe(true);
    const resetIcons = await harness.behavior.runCli([
      "prefs",
      "reset",
      "showProviderIcons",
      "--json",
    ]);
    expect(JSON.parse(resetIcons.stdout)).toEqual({
      key: "showProviderIcons",
      value: true,
    });

    const bad = await harness.behavior.runCli([
      "prefs",
      "set",
      "organizationMode",
      "nope",
    ]);
    expect(bad.exitCode).not.toBe(0);
    expect(bad.stderr).toMatch(/Invalid value for organizationMode/);

    const unknown = await harness.behavior.runCli(["prefs", "get", "colour"]);
    expect(unknown.exitCode).not.toBe(0);
    expect(unknown.stderr).toMatch(/Unknown preference: colour/);

    const reset = await harness.behavior.runCli([
      "prefs",
      "reset",
      "organizationMode",
      "--json",
    ]);
    expect(JSON.parse(reset.stdout)).toEqual({
      key: "organizationMode",
      value: "chronological",
    });
  });
});

it("validates lifecycle selection through CLI and RPC and broadcasts it", async () => {
  const { bb, harness } = setup();
  await plugin(bb);
  expect(
    (
      await harness.behavior.runCli([
        "prefs",
        "set",
        "threadLifecycles",
        '["archived"]',
      ])
    ).exitCode,
  ).toBe(0);
  await expect(
    bb.storage.kv.get("preference:threadLifecycles"),
  ).resolves.toEqual(["archived"]);
  for (const value of [[], ["archived", "archived"], ["deleted"]]) {
    await expect(
      harness.behavior.callRpc("setPreference", {
        key: "threadLifecycles",
        value,
      }),
    ).rejects.toThrow(/Invalid value/);
  }
  await expect(
    bb.storage.kv.get("preference:threadLifecycles"),
  ).resolves.toEqual(["archived"]);
  expect(harness.realtimeSignals).toContainEqual({
    channel: "preferences",
    payload: { key: "threadLifecycles", value: ["archived"] },
  });
});

describe("queued thread promotion", () => {
  async function promotionHost() {
    const host = setup();
    await plugin(host.bb);
    await host.harness.behavior.callRpc("setPreference", {
      key: "autoActiveSectionId",
      value: "sec_active",
    });
    await host.harness.behavior.callRpc("setPreference", {
      key: "manualThreadOrder",
      value: ["existing", "queued", "other"],
    });
    host.harness.sdk.stub("threadSections.list", async () => [
      { id: "sec_active", name: "Active", createdAt: 1, updatedAt: 1 },
    ]);
    const thread = makeThreadResponse({
      id: "queued",
      status: "active",
      sectionId: null,
    });
    host.harness.sdk.stub("threads.get", async () => thread);
    host.harness.sdk.stub("threads.update", async () => ({
      ...thread,
      sectionId: "sec_active",
    }));
    return { ...host, thread };
  }

  it("moves a newly running queued thread to Active and prepends it without duplicates", async () => {
    const { harness, thread } = await promotionHost();
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(harness.sdk.callsTo("threads.update")).toEqual([
      [{ threadId: "queued", sectionId: "sec_active" }],
    ]);
    const result = await harness.behavior.callRpc("listPreferences", null);
    expect(result).toMatchObject({
      preferences: {
        manualThreadOrder: ["queued", "existing", "other"],
        chronologicalSort: "manual",
      },
    });
  });

  it.each([
    { sectionId: "sec_completed" },
    { sectionId: "sec_active" },
    { pinnedAt: 1 },
    { archivedAt: 1 },
    { deletedAt: 1 },
    { parentThreadId: "parent" },
    { status: "idle" as const },
  ])(
    "leaves threads outside the running queue alone: %j",
    async (overrides) => {
      const { harness, thread } = await promotionHost();
      harness.sdk.stub("threads.get", async () => ({
        ...thread,
        ...overrides,
      }));
      await harness.behavior.emitThreadEvent("thread.active", { thread });
      expect(harness.sdk.callsTo("threads.update")).toEqual([]);
    },
  );

  it("does nothing when the rule is disabled or its destination was deleted", async () => {
    const { harness, thread } = await promotionHost();
    await harness.behavior.callRpc("setPreference", {
      key: "autoActiveSectionId",
      value: null,
    });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(harness.sdk.callsTo("threads.get")).toEqual([]);
    await harness.behavior.callRpc("setPreference", {
      key: "autoActiveSectionId",
      value: "sec_deleted",
    });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(harness.sdk.callsTo("threads.update")).toEqual([]);
  });

  it.each([
    ["existing", "queued", "other"],
    ["existing", "other"],
  ])(
    "returns a finished Active thread to the top of Queued with saved order %j",
    async (...order) => {
      const { harness, thread } = await promotionHost();
      for (const [key, value] of [
        ["manualThreadOrder", order],
        ["chronologicalSort", "updated"],
        ["groupByReadStatus", true],
      ] as const) {
        await harness.behavior.callRpc("setPreference", { key, value });
      }
      const finished = {
        ...thread,
        status: "idle" as const,
        sectionId: "sec_active",
      };
      harness.sdk.stub("threads.get", async () => finished);
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: finished,
        lastAssistantText: "Done",
      });
      expect(harness.sdk.callsTo("threads.update")).toEqual([
        [{ threadId: thread.id, sectionId: null }],
      ]);
      expect(
        await harness.behavior.callRpc("listPreferences", null),
      ).toMatchObject({
        preferences: {
          manualThreadOrder: ["queued", "existing", "other"],
          chronologicalSort: "manual",
          groupByReadStatus: false,
        },
      });
    },
  );

  it.each([
    { sectionId: "sec_completed" },
    { sectionId: "sec_other" },
    { sectionId: null },
    { status: "active" as const },
    { status: "starting" as const },
    { status: "error" as const },
    { pinnedAt: 1 },
    { archivedAt: 1 },
    { deletedAt: 1 },
    { parentThreadId: "parent" },
  ])(
    "preserves current placement when a finish event is stale or outside Active: %j",
    async (overrides) => {
      const { harness, thread } = await promotionHost();
      const finished = {
        ...thread,
        status: "idle" as const,
        sectionId: "sec_active",
      };
      harness.sdk.stub("threads.get", async () => ({
        ...finished,
        ...overrides,
      }));
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: finished,
        lastAssistantText: null,
      });
      expect(harness.sdk.callsTo("threads.update")).toEqual([]);
    },
  );

  it("leaves finished threads alone when automatic Active placement is disabled", async () => {
    const { harness, thread } = await promotionHost();
    await harness.behavior.callRpc("setPreference", {
      key: "autoActiveSectionId",
      value: null,
    });
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread,
      lastAssistantText: null,
    });
    expect(harness.sdk.callsTo("threads.get")).toEqual([]);
  });

  it("can return a thread to Queued after an earlier return failed", async () => {
    const { harness, thread } = await promotionHost();
    const finished = {
      ...thread,
      status: "idle" as const,
      sectionId: "sec_active",
    };
    harness.sdk.stub("threads.get", async () => finished);
    harness.sdk.stub("threads.update", async () => {
      throw new Error("offline");
    });
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: finished,
      lastAssistantText: null,
    });
    harness.sdk.stub("threads.update", async () => ({
      ...finished,
      sectionId: null,
    }));
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: finished,
      lastAssistantText: null,
    });
    expect(harness.sdk.callsTo("threads.update")).toHaveLength(2);
  });

  it("serializes simultaneous starts so both keep their place at the top", async () => {
    const { harness } = await promotionHost();
    harness.sdk.stub("threads.get", async ({ threadId }) =>
      makeThreadResponse({ id: threadId, status: "active" }),
    );
    await Promise.all(
      ["first", "second"].map((id) =>
        harness.behavior.emitThreadEvent("thread.active", {
          thread: makeThreadResponse({ id, status: "active" }),
        }),
      ),
    );
    const result = await harness.behavior.callRpc("listPreferences", null);
    expect(result).toMatchObject({
      preferences: {
        manualThreadOrder: ["second", "first", "existing", "queued", "other"],
      },
    });
  });

  it("recovers after a failed move without changing the saved order", async () => {
    const { harness, thread } = await promotionHost();
    harness.sdk.stub("threads.update", async () => {
      throw new Error("offline");
    });
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(
      await harness.behavior.callRpc("listPreferences", null),
    ).toMatchObject({
      preferences: { manualThreadOrder: ["existing", "queued", "other"] },
    });
    harness.sdk.stub("threads.update", async () => ({
      ...thread,
      sectionId: "sec_active",
    }));
    await harness.behavior.emitThreadEvent("thread.active", { thread });
    expect(
      await harness.behavior.callRpc("listPreferences", null),
    ).toMatchObject({
      preferences: { manualThreadOrder: ["queued", "existing", "other"] },
    });
  });
});
