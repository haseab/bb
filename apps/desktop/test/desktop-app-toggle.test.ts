import { describe, it, expect, vi } from "vitest";
import { createDesktopAppToggle } from "../src/desktop-app-toggle.js";

function setup() {
  const window = {
    id: 1,
    isDestroyed: () => false,
    isFocused: vi.fn(() => true),
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  const args = {
    platform: "darwin" as const,
    windows: () => [window],
    hide: vi.fn(),
    show: vi.fn(),
    createWindow: vi.fn(async () => {}),
    register: vi.fn(() => true),
    unregister: vi.fn(),
    warn: vi.fn(),
  };
  return { window, args, toggle: createDesktopAppToggle(args) };
}
describe("desktop app toggle", () => {
  it("hides the focused app and restores its minimized window when invoked from another app", () => {
    const { window, args, toggle } = setup();
    toggle.start();
    expect(args.register).toHaveBeenCalledWith(
      "Command+5",
      expect.any(Function),
    );
    toggle.toggle();
    expect(args.hide).toHaveBeenCalledOnce();
    window.isFocused.mockReturnValue(false);
    toggle.toggle();
    expect(args.show).toHaveBeenCalledOnce();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    toggle.dispose();
    expect(args.unregister).toHaveBeenCalledWith("Command+5");
  });
  it("honors disabled bindings from a new server while retaining the default with older servers", () => {
    const { args, toggle } = setup();
    toggle.start();
    toggle.sync([], false);
    expect(args.unregister).not.toHaveBeenCalled();
    toggle.sync([], true);
    expect(args.unregister).toHaveBeenCalledWith("Command+5");
  });
  it("reports an occupied global shortcut without unregistering another application's shortcut", () => {
    const { args, toggle } = setup();
    args.register.mockReturnValue(false);
    toggle.start();
    expect(args.warn).toHaveBeenCalledOnce();
    toggle.dispose();
    expect(args.unregister).not.toHaveBeenCalled();
  });
  it("creates a window once when all windows were closed", async () => {
    const { args, toggle } = setup();
    args.windows = () => [];
    toggle.toggle();
    toggle.toggle();
    await Promise.resolve();
    expect(args.createWindow).toHaveBeenCalledOnce();
  });
});
