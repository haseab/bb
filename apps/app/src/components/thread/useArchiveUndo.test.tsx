// @vitest-environment jsdom

import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useArchiveUndo } from "./useArchiveUndo";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { dismiss: vi.fn() },
}));

afterEach(cleanup);

it("runs the archive restore only once even if its toast callback is repeated", () => {
  const { result } = renderHook(useArchiveUndo);
  const undo = vi.fn();
  const options = result.current("archive", undo, 10_000);
  const action = options.cancel;
  if (!action) throw new Error("Missing Undo");
  const view = render(<button onClick={action.onClick}>Undo</button>);
  fireEvent.click(view.getByRole("button", { name: "Undo" }));
  fireEvent.click(view.getByRole("button", { name: "Undo" }));
  expect(undo).toHaveBeenCalledTimes(1);
});
