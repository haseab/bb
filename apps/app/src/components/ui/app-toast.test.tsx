// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppToastContent, appToast } from "./app-toast";

afterEach(() => {
  cleanup();
});

describe("AppToastContent", () => {
  it("wraps titles and descriptions while keeping actions available", () => {
    render(
      <AppToastContent
        action={{ label: "View log", onClick: vi.fn() }}
        cancel={{ label: "Dismiss", onClick: vi.fn() }}
        description="A deliberately long detail that can wrap"
        title="A deliberately long visual bell title that can wrap"
        tone="error"
      />,
    );

    expect(
      screen
        .getByText("A deliberately long visual bell title that can wrap")
        .classList.contains("line-clamp-4"),
    ).toBe(true);
    expect(
      screen
        .getByText("A deliberately long detail that can wrap")
        .classList.contains("line-clamp-4"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "View log" })
        .parentElement?.classList.contains("flex-wrap"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "View log" })
        .classList.contains("underline"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Dismiss notification" }),
    ).toBeDefined();
  });

  it("neutralizes Sonner margins on custom toast icons", () => {
    const { container } = render(
      <AppToastContent title="Thread archived" tone="success" />,
    );

    expect(
      container.querySelector<SVGElement>('[data-icon="CircleCheck"]')?.style
        .margin,
    ).toBe("0px");
    expect(
      container.querySelector<SVGElement>('[data-icon="X"]')?.style.margin,
    ).toBe("0px");
  });

  it("dismisses from the visible close control", () => {
    const onDismiss = vi.fn();
    render(
      <AppToastContent
        onDismiss={onDismiss}
        title="Plugin settings saved"
        tone="success"
      />,
    );

    screen.getByRole("button", { name: "Dismiss notification" }).click();

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("Undo toast shortcuts", () => {
  const key = (key: string, overrides = {}) =>
    fireEvent.keyDown(window, { key, metaKey: true, ...overrides });

  it("undoes the newest actionable toast once without informational toasts stealing it", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <AppToastContent
          id="first"
          title="Archived"
          tone="success"
          cancel={{ label: "Undo", onClick: first }}
        />
        <AppToastContent
          id="second"
          title="Completed"
          tone="success"
          cancel={{ label: "Undo", onClick: second }}
        />
        <AppToastContent id="info" title="Connected" tone="message" />
      </>,
    );
    expect(key("z")).toBe(false);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(key("z", { metaKey: false, ctrlKey: true })).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(key("z")).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[1]!);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it.each(["keyboard", "button"])(
    "confirms via %s and retires Undo before the toast exits",
    (surface) => {
      const undo = vi.fn();
      const confirm = vi.fn();
      render(
        <AppToastContent
          id="complete"
          title="Completed"
          tone="success"
          cancel={{ label: "Undo", onClick: undo }}
          onDismiss={confirm}
        />,
      );
      if (surface === "keyboard") expect(key("Enter")).toBe(false);
      else fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      expect(confirm).toHaveBeenCalledOnce();
      expect(key("z")).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(undo).not.toHaveBeenCalled();
    },
  );

  it("preserves text shortcuts after editing while the Undo button still works", () => {
    const undo = vi.fn();
    render(
      <AppToastContent
        id="complete"
        title="Completed"
        tone="success"
        cancel={{ label: "Undo", onClick: undo }}
      />,
    );
    for (const overrides of [
      { shiftKey: true },
      { repeat: true },
      { altKey: true },
      { metaKey: false },
    ]) {
      expect(key("z", overrides)).toBe(true);
    }
    fireEvent.input(window);
    expect(key("z")).toBe(true);
    expect(key("Enter")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
  });

  it("removes shortcuts on dismissal and unmount", () => {
    const undo = vi.fn();
    const view = render(
      <AppToastContent
        id="complete"
        title="Completed"
        tone="success"
        cancel={{ label: "Undo", onClick: undo }}
      />,
    );
    appToast.dismiss("complete");
    expect(key("z")).toBe(true);
    view.unmount();
    expect(key("Enter")).toBe(true);
    expect(undo).not.toHaveBeenCalled();
  });
});
