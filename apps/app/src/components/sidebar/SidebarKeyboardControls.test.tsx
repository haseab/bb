// @vitest-environment jsdom

import { getDefaultStore } from "jotai";
import { sidebarThreadFocusRequestAtom } from "@/lib/sidebar-thread-focus";
import { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import type { ThreadListEntry } from "@bb/domain";
import { SidebarKeyboardControls } from "./SidebarKeyboardControls";

const state = vi.hoisted(() => ({
  handlers: new Map<string, () => boolean>(),
  entries: new Map<string, ThreadListEntry>(),
  archive: vi.fn(async () => {}),
  dispatch: vi.fn(() => true),
  setOpen: vi.fn(),
  setOpenMobile: vi.fn(),
}));
vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: (id: string, handler: () => boolean) => {
    state.handlers.set(id, handler);
  },
  useAppCommandRunner: () => ({ dispatch: state.dispatch }),
}));
vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({
    isCompactViewport: false,
    setOpen: state.setOpen,
    setOpenMobile: state.setOpenMobile,
  }),
}));
vi.mock("@/lib/sidebar-thread-entries", () => ({
  useSidebarThreadEntries: () => state.entries,
}));
vi.mock("@/lib/thread-actions/thread-action-registry", () => ({
  useThreadActionEntries: () => [
    { action: { run: state.archive, disabled: false } },
  ],
}));

const visibility = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "checkVisibility",
);
const scrolling = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

function Harness({
  ids = ["first", "second", "third"],
  activeThreadId = "first",
  enabled = true,
}: {
  ids?: string[];
  activeThreadId?: string | null;
  enabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={root}>
        <SidebarKeyboardControls
          rootRef={root}
          activeThreadId={activeThreadId}
          enabled={enabled}
        />
        {ids.map((id) => (
          <div key={id} data-sidebar-rename-row="">
            <a
              href={"#" + id}
              data-sidebar-thread-id={id}
              data-sidebar-thread-shortcut-target=""
            >
              {id}
            </a>
          </div>
        ))}
        <input aria-label="Rename" />
      </div>
      <div data-app-content-shell="">
        <div data-app-composer="">
          <input aria-label="Composer" />
        </div>
        <input aria-label="New project search" />
      </div>
    </>
  );
}

beforeEach(() => {
  getDefaultStore().set(sidebarThreadFocusRequestAtom, null);
  state.handlers.clear();
  vi.clearAllMocks();
  for (const id of ["first", "second", "third"])
    state.entries.set(id, makeThreadListEntry({ id }));
  Object.defineProperty(Element.prototype, "checkVisibility", {
    configurable: true,
    value: () => true,
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
});
afterEach(() => {
  cleanup();
  getDefaultStore().set(sidebarThreadFocusRequestAtom, null);
  vi.restoreAllMocks();
  state.entries.clear();
  if (visibility)
    Object.defineProperty(Element.prototype, "checkVisibility", visibility);
  else Reflect.deleteProperty(Element.prototype, "checkVisibility");
  if (scrolling)
    Object.defineProperty(Element.prototype, "scrollIntoView", scrolling);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});
function command(id: string) {
  return state.handlers.get(id)?.();
}

describe("sidebar keyboard focus", () => {
  it("selects rows with arrows without opening them and stops at either end", () => {
    render(<Harness />);
    act(() => {
      command("sidebar.focus");
    });
    const first = screen.getByRole("link", { name: "first" });
    const second = screen.getByRole("link", { name: "second" });
    const clicked = vi.fn();
    second.addEventListener("click", clicked);
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.keyDown(second, { key: "ArrowDown" });
    const third = screen.getByRole("link", { name: "third" });
    fireEvent.keyDown(third, { key: "ArrowDown" });
    expect(document.activeElement).toBe(third);
  });

  it("restores a visible selector on the first focus command without waiting for animation frames", () => {
    render(<Harness />);
    act(() => screen.getByRole("textbox", { name: "Composer" }).focus());
    vi.mocked(window.requestAnimationFrame).mockClear();
    act(() => {
      command("sidebar.focus");
    });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "first" }),
    );
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("remembers the sidebar selector and restores focus to the chat field", () => {
    render(<Harness />);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    act(() => composer.focus());
    act(() => {
      command("sidebar.focus");
    });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    act(() => {
      command("chat.focus");
    });
    expect(document.activeElement).toBe(composer);
    act(() => {
      command("sidebar.focus");
    });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "second" }),
    );
  });

  it("targets the selected thread's archive action and retains a neighbor after removal", async () => {
    const view = render(<Harness />);
    act(() => {
      command("sidebar.focus");
    });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    act(() => {
      command("sidebar.archiveSelected");
    });
    expect(state.archive).toHaveBeenCalledOnce();
    view.rerender(<Harness ids={["first", "third"]} />);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("link", { name: "third" }),
      ),
    );
  });

  it("keeps a clicked thread focused and ready for selector shortcuts", () => {
    const view = render(<Harness />);
    const second = screen.getByRole("link", { name: "second" });
    fireEvent.click(second);
    view.rerender(<Harness activeThreadId="second" />);
    expect(second.getAttribute("data-sidebar-thread-cursor")).toBe("true");
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "third" }),
    );
    act(() => {
      command("sidebar.archiveSelected");
    });
    expect(state.archive).toHaveBeenCalledOnce();
  });

  it.each(["completion", "archive"])(
    "moves the cursor to the conversation shown after %s without taking chat focus",
    (action) => {
      const view = render(<Harness activeThreadId="second" />);
      const composer = screen.getByRole("textbox", { name: "Composer" });
      act(() => composer.focus());
      view.rerender(
        <Harness
          activeThreadId="third"
          ids={
            action === "archive"
              ? ["first", "third"]
              : ["second", "first", "third"]
          }
        />,
      );
      expect(
        screen
          .getByRole("link", { name: "third" })
          .getAttribute("data-sidebar-thread-cursor"),
      ).toBe("true");
      expect(
        screen
          .getByRole("link", { name: "first" })
          .hasAttribute("data-sidebar-thread-cursor"),
      ).toBe(false);
      expect(document.activeElement).toBe(composer);
      act(() => {
        command("sidebar.focus");
      });
      expect(document.activeElement).toBe(
        screen.getByRole("link", { name: "third" }),
      );
    },
  );

  it("keeps keyboard focus with the cursor when the next conversation opens", () => {
    const view = render(<Harness activeThreadId="second" />);
    act(() => screen.getByRole("link", { name: "second" }).focus());
    view.rerender(<Harness activeThreadId="third" />);
    const third = screen.getByRole("link", { name: "third" });
    expect(third.getAttribute("data-sidebar-thread-cursor")).toBe("true");
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: "ArrowUp" });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "second" }),
    );
  });

  it("retains the next cursor when a row disappears while chat has focus", async () => {
    const view = render(<Harness activeThreadId="second" />);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    act(() => composer.focus());
    view.rerender(<Harness activeThreadId="second" ids={["first", "third"]} />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("link", { name: "third" })
          .getAttribute("data-sidebar-thread-cursor"),
      ).toBe("true"),
    );
    expect(document.activeElement).toBe(composer);
  });

  it("synchronizes the selector when the sidebar becomes available after navigation", () => {
    const view = render(<Harness activeThreadId="first" enabled={false} />);
    view.rerender(<Harness activeThreadId="third" enabled={false} />);
    view.rerender(<Harness activeThreadId="third" />);
    expect(
      screen
        .getByRole("link", { name: "third" })
        .getAttribute("data-sidebar-thread-cursor"),
    ).toBe("true");
  });

  it("restores Undo selection across delayed row removal and remount, then releases it for arrow navigation", async () => {
    const view = render(<Harness activeThreadId="third" />);
    act(() =>
      getDefaultStore().set(sidebarThreadFocusRequestAtom, {
        threadId: "second",
      }),
    );
    const oldRow = screen.getByRole("link", { name: "second" });
    expect(document.activeElement).toBe(oldRow);
    view.rerender(<Harness activeThreadId="second" ids={["first", "third"]} />);
    await act(async () => {});
    expect(
      document.querySelector("[data-sidebar-thread-cursor=true]"),
    ).toBeNull();
    view.rerender(<Harness activeThreadId="second" />);
    const restored = screen.getByRole("link", { name: "second" });
    expect(restored).not.toBe(oldRow);
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(restored.getAttribute("data-sidebar-thread-cursor")).toBe("true");
    fireEvent.keyDown(restored, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "third" }),
    );
    expect(getDefaultStore().get(sidebarThreadFocusRequestAtom)).toBeNull();
  });

  it("allows a new conversation to focus its search and composer without restoring the old thread", () => {
    const view = render(<Harness />);
    const second = screen.getByRole("link", { name: "second" });
    act(() => second.focus());
    view.rerender(<Harness activeThreadId={null} />);
    const search = screen.getByRole("textbox", { name: "New project search" });
    act(() => search.focus());
    expect(document.activeElement).toBe(search);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    act(() => composer.focus());
    expect(document.activeElement).toBe(composer);
  });

  it("lets an explicit click in the composer take keyboard ownership without losing the selector", () => {
    render(<Harness />);
    const second = screen.getByRole("link", { name: "second" });
    act(() => second.focus());
    const composer = screen.getByRole("textbox", { name: "Composer" });
    fireEvent.pointerDown(composer);
    act(() => composer.focus());
    fireEvent.keyDown(composer, { key: "ArrowDown" });
    expect(document.activeElement).toBe(composer);
    expect(second.getAttribute("data-sidebar-thread-cursor")).toBe("true");
    act(() => {
      command("sidebar.archiveSelected");
    });
    expect(state.archive).not.toHaveBeenCalled();
    act(() => {
      command("sidebar.focus");
    });
    expect(document.activeElement).toBe(second);
  });

  it("leaves modifier arrows, renaming, and chat typing alone", () => {
    render(<Harness />);
    act(() => {
      command("sidebar.focus");
    });
    const first = document.activeElement;
    fireEvent.keyDown(first!, { key: "ArrowDown", altKey: true });
    expect(document.activeElement).toBe(first);
    act(() => screen.getByRole("textbox", { name: "Rename" }).focus());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Rename" }),
    );
    act(() => {
      command("sidebar.archiveSelected");
    });
    expect(state.archive).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("textbox", { name: "Composer" }));
    act(() => screen.getByRole("textbox", { name: "Composer" }).focus());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Composer" }),
    );
  });
});
