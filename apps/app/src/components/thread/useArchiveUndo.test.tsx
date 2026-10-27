// @vitest-environment jsdom

import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useArchiveUndo } from "./useArchiveUndo";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { dismiss: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function key(overrides = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "z",
    metaKey: true,
    cancelable: true,
    bubbles: true,
    ...overrides,
  });
  window.dispatchEvent(event);
  return event;
}

describe("archive keyboard undo", () => {
  it("undoes recent archives in reverse order, once per action", () => {
    const { result } = renderHook(useArchiveUndo);
    const first = vi.fn();
    const second = vi.fn();
    result.current("first", first, 10_000);
    result.current("second", second, 10_000);
    expect(key().defaultPrevented).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(key({ metaKey: false, ctrlKey: true }).defaultPrevented).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(key().defaultPrevented).toBe(false);
  });

  it("leaves redo, plain Z, and held keys alone", () => {
    const { result } = renderHook(useArchiveUndo);
    const undo = vi.fn();
    result.current("archive", undo, 10_000);
    for (const overrides of [
      { shiftKey: true },
      { altKey: true },
      { metaKey: false },
      { repeat: true },
    ]) {
      expect(key(overrides).defaultPrevented).toBe(false);
    }
    expect(undo).not.toHaveBeenCalled();
  });

  it("expires and removes dismissed toasts without swallowing text undo", () => {
    const { result } = renderHook(useArchiveUndo);
    const undo = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    result.current("expired", undo, 10_000);
    vi.spyOn(Date, "now").mockReturnValue(11_000);
    expect(key().defaultPrevented).toBe(false);
    const dismissed = result.current("dismissed", undo, 10_000);
    dismissed.onDismiss?.({ id: "dismissed" });
    expect(key().defaultPrevented).toBe(false);
    const closed = result.current("closed", undo, 10_000);
    closed.onAutoClose?.({ id: "closed" });
    expect(key().defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it("preserves editor undo after input while keeping the toast button usable", () => {
    const { result } = renderHook(useArchiveUndo);
    const undo = vi.fn();
    const options = result.current("archive", undo, 10_000);
    fireEvent.input(window);
    expect(key().defaultPrevented).toBe(false);
    const action = options.cancel;
    if (!action) throw new Error("Missing Undo");
    const view = render(<button onClick={action.onClick}>Undo</button>);
    fireEvent.click(view.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("removes keyboard handling when unmounted", () => {
    const { result, unmount } = renderHook(useArchiveUndo);
    const undo = vi.fn();
    result.current("archive", undo, 10_000);
    unmount();
    expect(key().defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });
});
