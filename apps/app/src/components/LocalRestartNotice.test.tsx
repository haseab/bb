// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalRestartStatus } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { LocalRestartNotice } from "./LocalRestartNotice";

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { localRestart: vi.fn(), controlLocalRestart: vi.fn() } },
}));
vi.mock("@/components/ui/app-toast", () => ({ appToast: { error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function status(phase: "building" | "waiting"): LocalRestartStatus {
  return {
    runtimeId: "runtime",
    paused: phase === "waiting",
    committed: false,
    inFlightCount: 0,
    runningThreadCount: 2,
    job: {
      id: "restart",
      phase,
      workerPid: 123,
      checkout: "/checkout",
      appPath: "/Applications/bb.app",
      logPath: "/log",
      message: null,
      updatedAt: 0,
    },
  };
}

function show(phase: "building" | "waiting") {
  vi.mocked(sdk.system.localRestart).mockResolvedValue(status(phase));
  vi.mocked(sdk.system.controlLocalRestart).mockResolvedValue(status(phase));
  const harness = createQueryClientTestHarness();
  render(<LocalRestartNotice />, { wrapper: harness.wrapper });
  return harness;
}

describe("local restart controls", () => {
  it("cannot force installation while building and can cancel", async () => {
    const harness = show("building");
    const force = await screen.findByRole("button", { name: "Restart now" });
    expect(force.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel restart" }));
    await waitFor(() =>
      expect(sdk.system.controlLocalRestart).toHaveBeenCalledWith({
        action: "cancel",
        id: "restart",
      }),
    );
    harness.queryClient.clear();
  });
  it("forces only after the user explicitly clicks Restart now", async () => {
    const harness = show("waiting");
    const force = await screen.findByRole("button", { name: "Restart now" });
    expect(sdk.system.controlLocalRestart).not.toHaveBeenCalled();
    fireEvent.click(force);
    await waitFor(() =>
      expect(sdk.system.controlLocalRestart).toHaveBeenCalledWith({
        action: "now",
        id: "restart",
      }),
    );
    harness.queryClient.clear();
  });
});
