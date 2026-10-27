// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useQuickCreateProject } from "./useQuickCreateProject";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  navigate: vi.fn(),
  setRootComposeProjectId: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useCreateProject: () => ({ isPending: false, mutate: mocks.mutate }),
}));

vi.mock("@/lib/root-compose-selection", () => ({
  useSetRootComposeProjectId: () => mocks.setRootComposeProjectId,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useQuickCreateProject", () => {
  it("opens a named project and selects it after creation without requiring a machine", () => {
    const { result } = renderHook(() => useQuickCreateProject());
    act(() => result.current.openCreateDialog());
    expect(result.current.isAvailable).toBe(true);
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.createProject("  Research  "));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { name: "Research" },
      expect.anything(),
    );
    expect(result.current.isOpen).toBe(true);
    act(() => mocks.mutate.mock.calls[0][1].onSuccess({ id: "proj_research" }));
    expect(result.current.isOpen).toBe(false);
    expect(mocks.setRootComposeProjectId).toHaveBeenCalledWith("proj_research");
    expect(mocks.navigate).toHaveBeenCalledWith(expect.any(String), {
      replace: true,
    });
  });
});
