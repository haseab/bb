// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarVersion } from "./SidebarVersion";

const state = vi.hoisted(() => ({
  buildVersion: null as string | null,
  desktopVersion: null as string | null,
  serverVersion: "0.47.1" as string | undefined,
}));
const useVersion = vi.hoisted(() => vi.fn());
vi.mock("virtual:bb-local-build", () => ({
  get localBuildVersion() {
    return state.buildVersion;
  },
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () =>
    state.desktopVersion === null ? null : { version: state.desktopVersion },
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemVersion: (options: { enabled: boolean }) => {
    useVersion(options);
    return {
      data:
        state.serverVersion === undefined
          ? undefined
          : { currentVersion: state.serverVersion },
    };
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.buildVersion = null;
  state.desktopVersion = null;
  state.serverVersion = "0.47.1";
});

describe("SidebarVersion", () => {
  it("shows the loaded frontend build revision even when the shell version is unchanged", () => {
    state.buildVersion = "0.47.1.12";
    state.desktopVersion = "0.47.1";
    render(<SidebarVersion />);
    const label = screen.getByLabelText("bb version 0.47.1.12");
    expect(label.children[0].textContent).toBe("v0.47");
    expect(label.children[1].textContent).toBe("#12");
  });
  it("shows the desktop version even when the connected server runs another version", () => {
    state.desktopVersion = "0.48.0";
    render(<SidebarVersion />);
    expect(screen.getByLabelText("bb version 0.48.0").textContent).toBe(
      "v0.48",
    );
    expect(useVersion).toHaveBeenCalledWith({ enabled: false });
  });

  it("shows the server version in a browser", () => {
    render(<SidebarVersion />);
    expect(screen.getByLabelText("bb version 0.47.1").textContent).toBe(
      "v0.47",
    );
    expect(useVersion).toHaveBeenCalledWith({ enabled: true });
  });

  it("does not invent a version while the browser is still loading it", () => {
    state.serverVersion = undefined;
    const { container } = render(<SidebarVersion />);
    expect(container.querySelector("[data-sidebar-version]")).toBeNull();
  });
});
