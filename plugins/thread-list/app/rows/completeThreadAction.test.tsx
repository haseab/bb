// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { defaultPreferences } from "../../shared/preferences.js";
import {
  resetPreferencesSyncForTest,
  setPreferencesMirrorStorageForTest,
} from "../preferences/preferences-sync.js";
import { toast } from "sonner";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { makeSidebarThread, sdkResult } from "../model/fixtures.js";
import { toThreadActionTarget } from "./threadActionTarget.js";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

installTestPluginRuntime();
const { useSdk, useBbNavigate } = await import("@get-bb/plugin-sdk/app");
const { completeThreadAction, useThreadCompletion } =
  await import("./completeThreadAction.js");

function Probe({ thread }: { thread: PluginThreadActionTarget }) {
  const data = useThreadCompletion();
  const action = completeThreadAction.item({
    thread,
    data,
    sdk: useSdk(),
    navigate: useBbNavigate(),
  });
  return action ? (
    <button
      disabled={action.disabled}
      onClick={() => void action.run({ requestRename() {} })}
    >
      {action.label}
    </button>
  ) : null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetPreferencesSyncForTest();
  setPreferencesMirrorStorageForTest(undefined);
});

describe("Complete thread menu action", () => {
  it.each([
    [null, "Complete", true],
    ["sec_completed", "Reopen", false],
  ] as const)(
    "offers %s as %s and calls the shared operation",
    async (sectionId, label, completed) => {
      setPreferencesMirrorStorageForTest(null);
      const update = vi.fn(sdkResult({ ok: true }));
      const pin = vi.fn(sdkResult({ ok: true }));
      const setCompleted = vi.fn(() => ({
        threadId: "thr_task",
        sectionId: completed ? "sec_completed" : null,
      }));
      renderSlot(
        { component: Probe },
        {
          thread: toThreadActionTarget(
            makeSidebarThread({ id: "thr_task", sectionId }),
          ),
        },
        {
          sdk: {
            threads: {
              update,
              pin,
              get: vi.fn(
                sdkResult(makeThreadResponse({ id: "thr_task", sectionId })),
              ),
            },
          },
          rpc: {
            listPreferences: () => ({
              preferences: {
                ...defaultPreferences(),
                completedSectionId: "sec_completed",
              },
            }),
            setCompleted,
          },
        },
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: label }).hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() =>
        expect(setCompleted).toHaveBeenCalledWith({
          threadId: "thr_task",
          completed,
        }),
      );
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          completed ? "Thread completed" : "Thread reopened",
          expect.objectContaining({
            cancel: { label: "Undo", onClick: expect.any(Function) },
            duration: 10_000,
          }),
        ),
      );
      const options = vi.mocked(toast.success).mock.calls[0]?.[1];
      const undo = options?.cancel;
      if (!undo || typeof undo !== "object" || !("onClick" in undo))
        throw new Error("Missing Undo");
      render(<button onClick={undo.onClick}>Undo</button>);
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith({
          threadId: "thr_task",
          sectionId,
          parentThreadId: null,
        }),
      );
      expect(pin).not.toHaveBeenCalled();
    },
  );

  it("leaves archived threads to the archive actions", async () => {
    renderSlot(
      { component: Probe },
      { thread: toThreadActionTarget(makeSidebarThread({ archivedAt: 1 })) },
      {
        rpc: { listPreferences: () => ({ preferences: defaultPreferences() }) },
      },
    );
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });
  it.each([false, true])(
    "restores the original completion state and handles a failed restore: %s",
    async (fails) => {
      setPreferencesMirrorStorageForTest(null);
      const update = vi.fn(sdkResult({ ok: true }));
      const pin = vi.fn(sdkResult({ ok: true }));
      if (fails) update.mockRejectedValueOnce(new Error("Update failed"));
      renderSlot(
        { component: Probe },
        {
          thread: toThreadActionTarget(makeSidebarThread({ id: "thr_task" })),
        },
        {
          sdk: {
            threads: {
              get: vi.fn(
                sdkResult(
                  makeThreadResponse({
                    id: "thr_task",
                    sectionId: "sec_original",
                    parentThreadId: "thr_parent",
                    pinnedAt: 1,
                  }),
                ),
              ),
              update,
              pin,
            },
          },
          rpc: {
            listPreferences: () => ({ preferences: defaultPreferences() }),
            setCompleted: () => ({
              threadId: "thr_task",
              sectionId: "sec_completed",
            }),
          },
        },
      );
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: "Complete" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "Complete" }));
      await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
      const options = vi.mocked(toast.success).mock.calls[0]?.[1];
      const action = options?.cancel;
      if (!action || typeof action !== "object" || !("onClick" in action))
        throw new Error("Missing Undo");
      render(<button onClick={action.onClick}>Undo completion</button>);
      fireEvent.click(screen.getByRole("button", { name: "Undo completion" }));
      if (fails) {
        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(
            "Failed to undo thread change.",
          ),
        );
        expect(pin).not.toHaveBeenCalled();
        return;
      }
      await waitFor(() =>
        expect(pin).toHaveBeenCalledWith({ threadId: "thr_task" }),
      );
      expect(update).toHaveBeenCalledWith({
        threadId: "thr_task",
        sectionId: "sec_original",
        parentThreadId: "thr_parent",
      });
      expect(update.mock.invocationCallOrder[0]).toBeLessThan(
        pin.mock.invocationCallOrder[0]!,
      );
    },
  );
});
