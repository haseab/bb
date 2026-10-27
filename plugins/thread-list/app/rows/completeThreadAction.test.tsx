// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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
import { makeSidebarThread } from "../model/fixtures.js";
import { toThreadActionTarget } from "./threadActionTarget.js";

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
});
