import type { AppKeybindings } from "@bb/domain";
import { isAppKeybindingAvailableForClient } from "@bb/domain";
import { formatElectronAccelerator } from "./desktop-menu-shortcuts.js";

interface ToggleWindow {
  id: number;
  isDestroyed(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function createDesktopAppToggle(args: {
  platform: NodeJS.Platform;
  windows(): ToggleWindow[];
  hide(): void;
  show(): void;
  createWindow(): Promise<void>;
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  warn(message: string): void;
}) {
  let accelerator: string | null = null;
  let creating = false;
  let lastFocusedId: number | null = null;
  function toggle() {
    const windows = args.windows().filter((window) => !window.isDestroyed());
    const focused = windows.find((window) => window.isFocused());
    if (focused) {
      lastFocusedId = focused.id;
      args.hide();
      return;
    }
    const window =
      windows.find((window) => window.id === lastFocusedId) ?? windows[0];
    if (window) {
      args.show();
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    } else if (!creating) {
      creating = true;
      void args
        .createWindow()
        .catch((error: unknown) => {
          args.warn(
            `Could not show bb: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          creating = false;
        });
    }
  }
  function bind(next: string | null) {
    if (next === accelerator) return;
    if (accelerator) args.unregister(accelerator);
    accelerator = null;
    if (next && args.register(next, toggle)) accelerator = next;
    else if (next)
      args.warn(
        `Could not register global shortcut ${next}; another app may already use it.`,
      );
  }
  return {
    start() {
      if (args.platform === "darwin") bind("Command+5");
    },
    sync(bindings: AppKeybindings, supported: boolean) {
      if (!supported) return;
      const binding = [...bindings].reverse().find(
        (item) =>
          item.command === "app.toggle" &&
          isAppKeybindingAvailableForClient(item, {
            isDesktop: true,
            platform: args.platform,
          }),
      );
      bind(
        binding ? (formatElectronAccelerator(binding.shortcut) ?? null) : null,
      );
    },
    rememberWindow(id: number) {
      lastFocusedId = id;
    },
    dispose() {
      bind(null);
    },
    toggle,
  };
}
