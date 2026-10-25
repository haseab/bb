// @vitest-environment jsdom
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

function Harness({ ids = ["first", "second", "third"] }: { ids?: string[] }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={root}>
        <SidebarKeyboardControls
          rootRef={root}
          activeThreadId="first"
          enabled
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
        <input aria-label="Composer" />
      </div>
    </>
  );
}

beforeEach(() => {
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
    act(() => screen.getByRole("textbox", { name: "Composer" }).focus());
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Composer" }),
    );
  });
});
