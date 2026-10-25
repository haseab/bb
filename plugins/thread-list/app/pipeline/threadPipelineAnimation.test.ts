// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  animateThreadPipelinePositions,
  captureThreadPipelinePositions,
} from "./threadPipelineAnimation.js";

function row(id: string, top: number) {
  const element = document.createElement("div");
  element.setAttribute("data-sidebar-rename-row", "");
  const link = document.createElement("a");
  link.href = "#thread";
  link.dataset.sidebarThreadId = id;
  element.append(link);
  const bounds = vi.fn(() => new DOMRect(0, top, 200, 28));
  element.getBoundingClientRect = bounds;
  const animate = vi.fn();
  element.animate = animate;
  document.body.append(element);
  return { element, link, bounds, animate };
}

afterEach(() => {
  document.body.replaceChildren();
  captureThreadPipelinePositions();
  vi.unstubAllGlobals();
});

describe("thread pipeline movement", () => {
  it("animates both displaced rows from their previous positions", () => {
    const first = row("first", 0);
    const second = row("second", 28);
    captureThreadPipelinePositions();
    first.bounds.mockReturnValue(new DOMRect(0, 28, 200, 28));
    second.bounds.mockReturnValue(new DOMRect(0, 0, 200, 28));
    animateThreadPipelinePositions();
    expect(first.animate).toHaveBeenCalledWith(
      [
        { transform: "translate(0px, -28px)" },
        { transform: "translate(0, 0)" },
      ],
      expect.objectContaining({ duration: 220 }),
    );
    expect(second.animate).toHaveBeenCalledOnce();
  });

  it("keeps the original positions through a render before the move lands", () => {
    const first = row("first", 0);
    captureThreadPipelinePositions();
    animateThreadPipelinePositions();
    expect(first.animate).not.toHaveBeenCalled();
    first.bounds.mockReturnValue(new DOMRect(0, 28, 200, 28));
    animateThreadPipelinePositions();
    expect(first.animate).toHaveBeenCalledOnce();
  });

  it("restores keyboard focus across section remounts even with reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const previous = row("first", 0);
    previous.link.focus();
    captureThreadPipelinePositions();
    previous.element.remove();
    const next = row("first", 100);
    animateThreadPipelinePositions();
    expect(document.activeElement).toBe(next.link);
    expect(next.animate).not.toHaveBeenCalled();
  });
});
