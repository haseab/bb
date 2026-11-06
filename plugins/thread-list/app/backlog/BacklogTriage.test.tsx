// @vitest-environment jsdom
import { testPanelController } from "../model/test-panel.js";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { makePluginProject, makeSidebarThread } from "../model/fixtures.js";
import {
  backlogStateAtom,
  RefreshedQueueDivider,
  useRefreshedQueueComparator,
} from "./state.js";
import {
  BacklogTriage,
  backlogTriageCommand,
  followUpThreadAction,
} from "./BacklogTriage.js";
import {
  buildSectionThreadList,
  compareStandardThreads,
  getProjectThreadItemDescendants,
} from "../model/project-thread-groups.js";
import type { BacklogState } from "../../shared/backlog.js";

import { useSdk, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toThreadActionTarget } from "../rows/threadActionTarget.js";

installTestPluginRuntime();
const now = Date.parse("2026-11-04T20:00:00Z");
const context = {
  threadId: "queued",
  projectId: "project",
  openPanel: () => false,
  experimental_panel: testPanelController,
};
function setup(fails = false, compact = false) {
  const threads = [
    makeSidebarThread({
      id: "untriaged",
      projectId: "project",
      title: "Untriaged",
      sectionId: "backlog",
    }),
    makeSidebarThread({
      id: "scheduled",
      projectId: "project",
      title: "Scheduled",
      sectionId: "backlog",
    }),
    makeSidebarThread({
      id: "queued",
      projectId: "project",
      title: "Queued",
      sectionId: null,
    }),
    makeSidebarThread({
      id: "active",
      projectId: "project",
      title: "Active",
      sectionId: "active",
      status: "active",
    }),
  ];
  const state: BacklogState = {
    sectionId: "backlog",
    items: threads.slice(0, 2).map((thread) => ({
      threadId: thread.id,
      sectionId: "backlog",
      enteredAt: now,
      followUpAt: thread.id === "scheduled" ? now + 100_000 : null,
      refreshAt: now + 7 * 86_400_000,
      refreshedAt: null,
      stage: "backlog",
    })),
  };
  const store = createStore();
  store.set(backlogStateAtom, state);
  function Surface() {
    return (
      <Provider store={store}>
        <CompactViewportOverrideProvider isCompactViewport={compact}>
          <div data-testid="app-root">
            <BacklogTriage />
          </div>
        </CompactViewportOverrideProvider>
      </Provider>
    );
  }
  const schedule = vi.fn(async () => {
    if (fails) throw new Error("offline");
    return {
      ...state,
      items: state.items.map((item) => ({
        ...item,
        followUpAt: now + 61 * 60_000,
      })),
    };
  });
  const view = renderSlot(
    { component: Surface },
    {},
    {
      sidebarThreads: {
        projects: [makePluginProject({ id: "project", name: "Project" })],
        threads,
        sections: [
          { id: "backlog", name: "Backlog", createdAt: 1, updatedAt: 1 },
        ],
      },
      rpc: { scheduleFollowUp: schedule },
    },
  );
  return { ...view, store, schedule, threads };
}
afterEach(cleanup);

describe("Backlog follow-up triage", () => {
  it("peeks at the triaged thread and restores the date draft without saving or advancing", async () => {
    const view = setup();
    await waitFor(() =>
      expect(backlogTriageCommand.isAvailable?.(context)).toBe(true),
    );
    act(() => {
      backlogTriageCommand.run(context);
    });
    const input = await screen.findByRole("textbox", { name: "Follow up" });
    fireEvent.change(input, { target: { value: "61 min" } });
    fireEvent.keyDown(input, { key: "p", metaKey: true });
    expect(view.inspection.navigateCalls.at(-1)).toEqual({
      method: "toThread",
      threadId: "untriaged",
      options: { experimental_userMessagesOnly: true },
    });
    expect(
      screen.getByRole("button", { name: /Your messages/ }),
    ).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    const restored = await screen.findByRole("textbox", { name: "Follow up" });
    expect(restored).toHaveProperty("value", "61 min");
    expect(view.inspection.navigateCalls.at(-1)).toEqual({
      method: "toThread",
      threadId: "untriaged",
      options: { experimental_userMessagesOnly: false },
    });
    expect(view.schedule).not.toHaveBeenCalled();
    expect(screen.getByText("Untriaged")).not.toBeNull();
  });

  it("opens untriaged Backlog threads from the banner and hides it after scheduling", async () => {
    const view = setup();
    const banner = await screen.findByRole("button", {
      name: "Triage 1 Backlog thread",
    });
    expect(banner.textContent).toContain("1 thread needs a follow-up date");
    fireEvent.click(banner);
    expect(banner.hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("app-root").hasAttribute("inert")).toBe(false);
    const input = await screen.findByRole("textbox", { name: "Follow up" });
    expect(screen.getByText("Untriaged")).not.toBeNull();
    expect(screen.queryByText("Scheduled")).toBeNull();
    expect(screen.queryByText("Queued")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
    fireEvent.change(input, { target: { value: "61 min" } });
    expect(
      screen
        .getByRole("button", { name: "Save and next" })
        .hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(view.schedule).toHaveBeenCalledOnce());
    expect(
      view.inspection.rpcCalls.find(
        (call) => call.method === "scheduleFollowUp",
      )?.input,
    ).toMatchObject({
      threadId: "untriaged",
      input: "61 min",
      onlyBacklog: true,
    });
    await screen.findByText(
      "No Backlog threads left to triage. Scheduled threads keep their follow-up dates.",
    );
    expect(
      screen.queryByRole("button", { name: "Triage 1 Backlog thread" }),
    ).toBeNull();
  });
  it("updates the banner as follow-up dates and backlog stages change", async () => {
    const view = setup();
    act(() => {
      view.store.set(backlogStateAtom, (state) => ({
        ...state,
        items: state.items.map((item) => ({ ...item, followUpAt: null })),
      }));
    });
    const banner = await screen.findByRole("button", {
      name: "Triage 2 Backlog threads",
    });
    expect(banner.textContent).toContain("2 threads need a follow-up date");
    act(() => {
      view.store.set(backlogStateAtom, (state) => ({
        ...state,
        items: state.items.map((item) => ({ ...item, stage: "refreshing" })),
      }));
    });
    expect(
      screen.queryByRole("button", { name: /Triage \d+ Backlog/ }),
    ).toBeNull();
  });
  it("keeps the mobile drawer deferred and leaves the app root accessible", async () => {
    setup(false, true);
    await waitFor(() =>
      expect(backlogTriageCommand.isAvailable?.(context)).toBe(true),
    );
    act(() => {
      backlogTriageCommand.run(context);
    });
    expect(screen.queryByText("Untriaged")).toBeNull();
    expect(
      document.querySelector("[data-responsive-drawer-placeholder]"),
    ).not.toBeNull();
    await screen.findByRole("textbox", { name: "Follow up" });
    expect(screen.getByTestId("app-root").hasAttribute("inert")).toBe(false);
    expect(screen.getByTestId("app-root").hasAttribute("aria-hidden")).toBe(
      false,
    );
  });
  it("dismisses existing popovers and supports Tab to skip and Escape to close", async () => {
    const view = setup();
    const source = document.createElement("input");
    const dismiss = vi.fn();
    source.addEventListener("keydown", (event) => {
      if (event.key === "Escape") dismiss();
    });
    document.body.append(source);
    try {
      source.focus();
      await waitFor(() =>
        expect(backlogTriageCommand.isAvailable?.(context)).toBe(true),
      );
      act(() => {
        backlogTriageCommand.run(context);
      });
      expect(dismiss).toHaveBeenCalledOnce();
      const input = await screen.findByRole("textbox", { name: "Follow up" });
      fireEvent.keyDown(input, { key: "Tab" });
      await screen.findByText(
        "No Backlog threads left to triage. Scheduled threads keep their follow-up dates.",
      );
      expect(view.schedule).not.toHaveBeenCalled();
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    } finally {
      source.remove();
    }
  });

  it("keeps the thread and input when saving fails", async () => {
    const view = setup(true);
    await waitFor(() =>
      expect(backlogTriageCommand.isAvailable?.(context)).toBe(true),
    );
    act(() => {
      backlogTriageCommand.run(context);
    });
    const input = await screen.findByRole("textbox", { name: "Follow up" });
    fireEvent.change(input, { target: { value: "7d" } });
    fireEvent.submit(input.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("offline");
    expect(input).toHaveProperty("value", "7d");
    expect(screen.getByText("Untriaged")).not.toBeNull();
  });
  it("allows a queued thread to be scheduled explicitly without including it in Cmd+E triage", async () => {
    const view = setup();
    function ScheduleButton() {
      const action = followUpThreadAction.item({
        thread: toThreadActionTarget(view.threads[2]),
        data: undefined,
        sdk: useSdk(),
        navigate: useBbNavigate(),
        experimental_panel: testPanelController,
      });
      return (
        <button
          onClick={() => {
            action?.run({ requestRename() {} });
          }}
        >
          Schedule queued
        </button>
      );
    }
    renderSlot({ component: ScheduleButton }, {});
    fireEvent.click(screen.getByRole("button", { name: "Schedule queued" }));
    const input = await screen.findByRole("textbox", { name: "Follow up" });
    expect(screen.getByText("Queued")).not.toBeNull();
    fireEvent.change(input, { target: { value: "7 days" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(view.schedule).toHaveBeenCalledOnce());
    expect(
      view.inspection.rpcCalls.find(
        (call) => call.method === "scheduleFollowUp",
      )?.input,
    ).toMatchObject({ threadId: "queued", onlyBacklog: false });
  });
});

describe("hot and refreshed queue separation", () => {
  it("keeps refreshed threads below hot work even when they share a worktree", async () => {
    const store = createStore();
    store.set(backlogStateAtom, {
      sectionId: "backlog",
      items: [
        {
          threadId: "refreshed",
          sectionId: "backlog",
          enteredAt: now,
          followUpAt: null,
          refreshAt: now,
          refreshedAt: now,
          stage: "refreshed",
        },
      ],
    });
    const environment = {
      id: "env",
      name: null,
      branchName: null,
      path: null,
      providerId: null,
      isWorktree: true,
      workspaceDisplayKind: "other" as const,
    };
    const threads = [
      makeSidebarThread({ id: "refreshed", updatedAt: 999, environment }),
      makeSidebarThread({ id: "hot-a", updatedAt: 1, environment }),
      makeSidebarThread({ id: "hot-b", updatedAt: 2, environment }),
    ];
    function Queue() {
      const compare = useRefreshedQueueComparator(
        compareStandardThreads,
        threads,
      );
      const items = buildSectionThreadList(threads, compare, [], true);
      return (
        <>
          {items.map((item, index) => (
            <div key={index}>
              <RefreshedQueueDivider items={items} index={index} />
              <span>
                {getProjectThreadItemDescendants([item])
                  .map((thread) => thread.id)
                  .join(",")}
              </span>
            </div>
          ))}
        </>
      );
    }
    renderSlot(
      {
        component: () => (
          <Provider store={store}>
            <Queue />
          </Provider>
        ),
      },
      {},
    );
    const divider = screen.getByRole("separator", { name: "Refreshed queue" });
    expect(
      divider.parentElement?.previousElementSibling?.textContent,
    ).toContain("hot-");
    expect(divider.parentElement?.textContent).toContain("refreshed");
    act(() => store.set(backlogStateAtom, { sectionId: "backlog", items: [] }));
    expect(screen.queryByRole("separator")).toBeNull();
  });
});
