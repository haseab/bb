// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import {
  makePluginProject,
  makeSidebarThread,
  makeSidebarEnvironment,
} from "../model/fixtures.js";
import { preferencesReadyAtom } from "../preferences/preferences-sync.js";
import {
  sidebarCollapsedThreadSectionsAtom,
  sidebarCompletedSectionIdAtom,
  sidebarOrganizationModeAtom,
  sidebarHiddenGroupsAtom,
  collapsedEnvironmentIdsAtom,
  collapsedThreadIdsAtom,
} from "../preferences/atoms.js";
import { buildSectionKey } from "../model/section-keys.js";
import { CHRONOLOGICAL_CONTAINER_ID } from "../model/project-thread-groups.js";
import type { OrganizationMode } from "../../shared/preferences.js";

installTestPluginRuntime();
const { ProjectList } = await import("./ProjectList.js");
const { resetSidebarDataCacheForTest } =
  await import("../model/use-sidebar-data.js");

const completedKey = buildSectionKey(
  CHRONOLOGICAL_CONTAINER_ID,
  "sec_completed",
);

function Harness({ store }: { store: ReturnType<typeof createStore> }) {
  const [active, setActive] = useState("thr_current");
  return (
    <TooltipProvider>
      <Provider store={store}>
        <button onClick={() => setActive("thr_other")}>
          Switch visible thread
        </button>
        <ProjectList activeThreadId={active} />
      </Provider>
    </TooltipProvider>
  );
}

function setup(
  mode: OrganizationMode,
  split = false,
  hidden = false,
  nested?: "parent" | "environment",
) {
  const store = createStore();
  store.set(preferencesReadyAtom(), true);
  store.set(sidebarOrganizationModeAtom, mode);
  store.set(sidebarCompletedSectionIdAtom, "sec_completed");
  store.set(sidebarCollapsedThreadSectionsAtom, [completedKey]);
  if (nested === "parent") store.set(collapsedThreadIdsAtom, ["thr_parent"]);
  if (nested === "environment")
    store.set(collapsedEnvironmentIdsAtom, ["env_test"]);
  if (hidden) store.set(sidebarHiddenGroupsAtom, ["threads"]);
  const result = renderSlot(
    { component: Harness },
    { store },
    {
      context: { projectId: "proj_test", threadId: "thr_current" },
      sidebarThreads: {
        threads: [
          ...(nested === "parent"
            ? [
                makeSidebarThread({
                  id: "thr_parent",
                  title: "Parent",
                  sectionId: "sec_completed",
                  environment: null,
                }),
              ]
            : []),
          ...["thr_current", "thr_other", "thr_closed"].map((id) =>
            makeSidebarThread({
              id,
              title: id,
              sectionId: hidden ? null : "sec_completed",
              parentThreadId: nested === "parent" ? "thr_parent" : null,
              environment:
                nested === "environment"
                  ? makeSidebarEnvironment({
                      isWorktree: true,
                      providerId: "git-worktree",
                    })
                  : null,
            }),
          ),
        ],
        projects: [makePluginProject({ isPersonal: true })],
        sections: [
          {
            id: "sec_completed",
            name: "Completed",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      ...(split
        ? {
            sidebarSplitLayout: {
              panes: ["thr_current", "thr_other"].map((threadId, index) => ({
                paneId: `pane_${index}`,
                threadId,
                isFocused: index === 0,
                rect: { x: index * 0.5, y: 0, width: 0.5, height: 1 },
              })),
            },
          }
        : {}),
    },
  );
  return { ...result, store };
}

function row(container: HTMLElement, id: string) {
  return container.querySelector(`[data-sidebar-thread-id="${id}"]`);
}

afterEach(() => {
  cleanup();
  resetSidebarDataCacheForTest();
});

describe("visible threads in collapsed sidebar groups", () => {
  it.each<OrganizationMode>(["chronological", "project", "machine"])(
    "reveals only the open completed thread in %s mode, then shows all on request",
    (mode) => {
      const { container, store } = setup(mode);
      expect(row(container, "thr_current")).not.toBeNull();
      expect(row(container, "thr_other")).toBeNull();
      expect(row(container, "thr_closed")).toBeNull();
      expect(
        screen
          .getByRole("button", { name: "Expand Completed section" })
          .getAttribute("aria-expanded"),
      ).toBe("true");
      expect(store.get(sidebarCollapsedThreadSectionsAtom)).toContain(
        completedKey,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Show all Completed" }),
      );
      expect(row(container, "thr_other")).not.toBeNull();
      expect(row(container, "thr_closed")).not.toBeNull();
      expect(store.get(sidebarCollapsedThreadSectionsAtom)).not.toContain(
        completedKey,
      );
    },
  );

  it("keeps every visible split thread revealed without exposing closed siblings", () => {
    const { container } = setup("chronological", true);
    expect(row(container, "thr_current")).not.toBeNull();
    expect(row(container, "thr_other")).not.toBeNull();
    expect(row(container, "thr_closed")).toBeNull();
    expect(container.querySelector(".bb-sidebar-selected-row")).not.toBeNull();
    expect(
      container.querySelector(".bb-sidebar-open-in-split-row"),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-sidebar-thread-id="thr_current"]')
        .length,
    ).toBe(1);
  });

  it.each(["parent", "environment"] as const)(
    "keeps the open thread visible inside a collapsed %s",
    (nested) => {
      const { container } = setup("project", false, false, nested);
      fireEvent.click(
        screen.getByRole("button", { name: "Show all Completed" }),
      );
      expect(row(container, "thr_current")).not.toBeNull();
      expect(row(container, "thr_other")).toBeNull();
      expect(row(container, "thr_closed")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", {
          name:
            nested === "parent"
              ? "Show all child threads"
              : "Show all environment threads",
        }),
      );
      expect(row(container, "thr_other")).not.toBeNull();
    },
  );

  it("updates the preview when the visible thread changes", () => {
    const { container, store } = setup("chronological");
    fireEvent.click(
      screen.getByRole("button", { name: "Switch visible thread" }),
    );
    expect(row(container, "thr_current")).toBeNull();
    expect(row(container, "thr_other")).not.toBeNull();
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toContain(
      completedKey,
    );
  });

  it("reveals visible threads from hidden groups without changing saved visibility", () => {
    const { container, store } = setup("chronological", false, true);
    expect(row(container, "thr_current")).not.toBeNull();
    expect(row(container, "thr_other")).toBeNull();
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual(["threads"]);
    fireEvent.click(screen.getByRole("button", { name: "Show all Threads" }));
    expect(row(container, "thr_other")).not.toBeNull();
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual([]);
  });
});
