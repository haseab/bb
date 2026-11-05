// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect } from "react";
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
import {
  ThreadCompletionControls,
  threadCompletionCommand,
} from "../pipeline/threadCompletionCommand.js";
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

  it.each(["complete", "reopen", "failed", "last", "windowed"] as const)(
    "opens the next chat only after successful completion: %s",
    async (mode) => {
      setPreferencesMirrorStorageForTest(null);
      const current = makeSidebarThread({
        id: "current",
        sectionId: mode === "reopen" ? "sec_completed" : null,
      });
      const next = makeSidebarThread({ id: "next" });
      let complete:
        | ReturnType<typeof useThreadCompletion>["setCompleted"]
        | undefined;
      function CompletionProbe() {
        const { setCompleted } = useThreadCompletion();
        useEffect(() => {
          complete = setCompleted;
        }, [setCompleted]);
        return (
          <div data-sidebar="content">
            <a href="#current" data-sidebar-thread-id="current">
              Current
            </a>
            {mode === "windowed" ? (
              <div data-sidebar-windowed-nav="next:proj_personal" />
            ) : (
              mode !== "last" && (
                <a href="#next" data-sidebar-thread-id="next">
                  Next
                </a>
              )
            )}
          </div>
        );
      }
      let resolve: (() => void) | undefined;
      const pending = new Promise<void>((done) => {
        resolve = done;
      });
      const setCompleted = vi.fn(async () => {
        await pending;
        if (mode === "failed") throw new Error("offline");
        return { threadId: "current", sectionId: "sec_completed" };
      });
      const view = renderSlot(
        { component: CompletionProbe },
        {},
        {
          sidebarThreads: {
            threads: [current, next],
            projects: [
              {
                id: current.projectId,
                name: "Project",
                href: "/",
                settingsHref: "/",
                isPersonal: false,
              },
            ],
            sections: [],
          },
          sdk: {
            threads: {
              get: vi.fn(sdkResult(makeThreadResponse({ id: "current" }))),
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
      await waitFor(() => expect(complete).toBeDefined());
      await waitFor(() =>
        expect(
          view.inspection.rpcCalls.some(
            (call) => call.method === "listPreferences",
          ),
        ).toBe(true),
      );
      let operation: Promise<void> | undefined;
      await act(async () => {
        operation = complete?.("current", mode !== "reopen");
        operation?.catch(() => {});
      });
      await waitFor(() => expect(setCompleted).toHaveBeenCalledOnce());
      expect(view.inspection.navigateCalls).toEqual([]);
      await act(async () => {
        resolve?.();
        if (mode === "failed")
          await expect(operation).rejects.toThrow("offline");
        else await operation;
      });
      expect(view.inspection.navigateCalls).toEqual(
        mode === "complete" || mode === "windowed"
          ? [{ method: "toThread", threadId: "next" }]
          : mode === "last"
            ? [{ method: "toCompose" }]
            : [],
      );
      if (mode === "windowed") {
        const nextLink = document.createElement("a");
        nextLink.href = "#next";
        nextLink.dataset.sidebarThreadId = "next";
        document.querySelector('[data-sidebar="content"]')?.append(nextLink);
        await waitFor(() => expect(document.activeElement).toBe(nextLink));
      }
      if (mode === "complete")
        expect(document.activeElement).toBe(
          screen.getByRole("link", { name: "Next" }),
        );
    },
  );

  it.each(["restored", "remounted", "failed"] as const)(
    "returns the Command+Enter selector to the thread after Undo: %s",
    async (mode) => {
      setPreferencesMirrorStorageForTest(null);
      const current = makeSidebarThread({ id: "current" });
      const next = makeSidebarThread({ id: "next" });
      function KeyboardProbe() {
        return (
          <>
            <ThreadCompletionControls />
            <div data-sidebar="content">
              <a href="#current" data-sidebar-thread-id="current">
                Current
              </a>
              <a href="#next" data-sidebar-thread-id="next">
                Next
              </a>
            </div>
          </>
        );
      }
      let resolveUpdate: (() => void) | undefined;
      let rejectUpdate: ((error: Error) => void) | undefined;
      const pendingUpdate = new Promise<ReturnType<typeof makeThreadResponse>>(
        (resolve, reject) => {
          resolveUpdate = () => resolve(makeThreadResponse({ id: "current" }));
          rejectUpdate = reject;
        },
      );
      const update = vi.fn(() => pendingUpdate);
      const view = renderSlot(
        { component: KeyboardProbe },
        {},
        {
          sidebarThreads: {
            threads: [current, next],
            projects: [
              {
                id: current.projectId,
                name: "Project",
                href: "/",
                settingsHref: "/",
                isPersonal: false,
              },
            ],
            sections: [],
          },
          sdk: {
            threads: {
              get: vi.fn(sdkResult(makeThreadResponse({ id: "current" }))),
              update,
            },
          },
          rpc: {
            listPreferences: () => ({ preferences: defaultPreferences() }),
            setCompleted: () => ({
              threadId: "current",
              sectionId: "sec_completed",
            }),
          },
        },
      );
      const context = {
        threadId: "current",
        projectId: current.projectId,
        openPanel: () => false,
      };
      const original = screen.getByRole("link", { name: "Current" });
      original.focus();
      await waitFor(() =>
        expect(threadCompletionCommand.isAvailable?.(context)).toBe(true),
      );
      await act(async () => threadCompletionCommand.run(context));
      expect(document.activeElement).toBe(
        screen.getByRole("link", { name: "Next" }),
      );
      const undo = vi.mocked(toast.success).mock.calls[0]?.[1]?.cancel;
      if (!undo || typeof undo !== "object" || !("onClick" in undo))
        throw new Error("Missing Undo");
      render(<button onClick={undo.onClick}>Undo selector</button>);
      fireEvent.click(screen.getByRole("button", { name: "Undo selector" }));
      await waitFor(() => expect(update).toHaveBeenCalledOnce());
      expect(document.activeElement).not.toBe(original);
      let restored = original;
      if (mode === "remounted") {
        restored = document.createElement("a");
        restored.setAttribute("href", "#current");
        restored.dataset.sidebarThreadId = "current";
        restored.textContent = "Current";
        original.replaceWith(restored);
      }
      await act(async () => {
        if (mode === "failed") rejectUpdate?.(new Error("offline"));
        else resolveUpdate?.();
      });
      if (mode === "failed") {
        await waitFor(() =>
          expect(toast.error).toHaveBeenCalledWith(
            "Failed to undo thread change.",
          ),
        );
        expect(document.activeElement).not.toBe(original);
      } else {
        await waitFor(() => expect(document.activeElement).toBe(restored));
        expect(threadCompletionCommand.isAvailable?.(context)).toBe(true);
      }
      expect(view.inspection.navigateCalls).toEqual([
        { method: "toThread", threadId: "next" },
      ]);
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
