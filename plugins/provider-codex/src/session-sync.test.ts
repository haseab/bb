import { describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import { registerCodexSessionSync } from "./session-sync.js";

function setup() {
  let enabled = true;
  let fail = false;
  const apply = vi.fn(async () => ({
    threadId: "bb-thread",
    status: "synced" as const,
  }));
  const { bb, harness } = createFakePluginHost({
    sdk: {
      subscribe: () => () => {},
      hosts: {
        list: async () => [
          makeHostResponse({ id: "local", status: "connected" }),
          makeHostResponse({ id: "offline", status: "disconnected" }),
        ],
      },
      providers: {
        list: async () => [
          { id: "codex", displayName: "Codex", pluginId: "provider-codex" },
        ],
      },
      projects: {
        list: async () => [
          {
            id: "project",
            kind: "standard",
            name: "Example",
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
            sources: [
              {
                id: "source",
                projectId: "project",
                type: "local_path",
                hostId: "local",
                path: "/project",
                isDefault: true,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
        ],
      },
    },
    experimental_callHostRpc(call) {
      if (fail) throw new Error("Host disconnected during read");
      if (call.method === "sessions.list")
        return {
          data: [
            {
              id: "native-thread",
              cwd: "/project",
              name: "Example",
              preview: "First message",
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          nextCursor: null,
        };
      return {
        session: {
          providerId: "codex",
          providerThreadId: "native-thread",
          cwd: "/project",
          title: "Example",
          createdAt: 1000,
          updatedAt: 2000,
          active: false,
          turns: [],
        },
        nextCursor: null,
      };
    },
  });
  vi.spyOn(
    bb.providers,
    "internal_DO_NOT_USE_syncNativeSession",
  ).mockImplementation(apply);
  registerCodexSessionSync(bb, async () => enabled);
  return {
    bb,
    harness,
    apply,
    disable: () => {
      enabled = false;
    },
    fail: () => {
      fail = true;
    },
    recover: () => {
      fail = false;
    },
  };
}

describe("Codex live conversation sync", () => {
  it("uses the same refresh path for SDK requests and CLI, and scopes every read to the connected host", async () => {
    const context = setup();
    try {
      expect(
        await context.harness.behavior.callRpc("sessions.sync", {}),
      ).toEqual({ synced: 1, busy: 0, errors: 0 });
      expect(context.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "local",
          providerThreadId: "native-thread",
        }),
      );
      expect(
        context.harness.inspection.experimental_hostRpcCalls.every(
          (call) => call.hostId === "local",
        ),
      ).toBe(true);
      await context.harness.behavior.callRpc("sessions.sync", {});
      expect(context.apply).toHaveBeenCalledTimes(2);
    } finally {
      await context.harness.lifecycle.dispose();
    }
  });

  it("leaves conversations intact when disabled and can recover after a host failure", async () => {
    const context = setup();
    try {
      context.fail();
      expect(
        await context.harness.behavior.callRpc("sessions.sync", {}),
      ).toEqual({ synced: 0, busy: 0, errors: 1 });
      context.recover();
      expect(
        await context.harness.behavior.callRpc("sessions.sync", {}),
      ).toEqual({ synced: 1, busy: 0, errors: 0 });
      context.disable();
      expect(
        await context.harness.behavior.callRpc("sessions.sync", {}),
      ).toEqual({ synced: 0, busy: 0, errors: 0 });
      expect(context.apply).toHaveBeenCalledTimes(1);
    } finally {
      await context.harness.lifecycle.dispose();
    }
  });

  it("aborts its refresh loop cleanly on provider disposal", async () => {
    const context = setup();
    const running = context.harness.runService("conversation-sync");
    running.controller.abort();
    await running.done;
    expect(context.apply).not.toHaveBeenCalled();
    await context.harness.lifecycle.dispose();
  });
});
