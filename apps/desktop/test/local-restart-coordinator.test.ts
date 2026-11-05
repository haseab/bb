import { describe, expect, it, vi } from "vitest";
import { waitForRestartWindow } from "../src/local-restart-coordinator";

const idle = { runtimeId: "original", runningThreadCount: 0, inFlightCount: 0 };

describe("safe restart window", () => {
  it("waits for active work and retries a raced idle commit", async () => {
    let sleeps = 0;
    let commits = 0;
    const calls: string[] = [];
    const result = await waitForRestartWindow({
      command: async () => null,
      control: async (action, force) => {
        calls.push(action);
        expect(force).toBe(false);
        if (action === "commit" && commits++ === 0)
          throw new Error("restart_busy");
        return { ...idle, runningThreadCount: sleeps === 0 ? 2 : 0 };
      },
      waiting: async () => {},
      sleep: async () => {
        sleeps++;
      },
    });
    expect(result).toEqual({ force: false, gated: true });
    expect(calls).toEqual(["acquire", "renew", "commit", "renew", "commit"]);
  });

  it("never falls back to killing work when the installed runtime lacks a gate", async () => {
    let cancelled = false;
    const waiting = vi.fn();
    await expect(
      waitForRestartWindow({
        command: async () => (cancelled ? "cancel" : null),
        control: async () => {
          throw new Error("restart_gate_unavailable");
        },
        waiting,
        sleep: async () => {
          cancelled = true;
        },
      }),
    ).rejects.toThrow("restart_cancelled");
    expect(waiting).toHaveBeenCalledWith(0, true);
  });

  it("requires an explicit now command to bypass an unsupported gate", async () => {
    expect(
      await waitForRestartWindow({
        command: async () => "now",
        control: async () => {
          throw new Error("restart_gate_unavailable");
        },
        waiting: async () => {},
        sleep: async () => {},
      }),
    ).toEqual({ force: true, gated: false });
  });

  it("refuses to restart a different runtime that appeared while waiting", async () => {
    let changed = false;
    await expect(
      waitForRestartWindow({
        command: async () => null,
        control: async () => ({
          ...idle,
          runtimeId: changed ? "replacement" : "original",
          inFlightCount: 1,
        }),
        waiting: async () => {},
        sleep: async () => {
          changed = true;
        },
      }),
    ).rejects.toThrow("runtime changed");
  });
});
