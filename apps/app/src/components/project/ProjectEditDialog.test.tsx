// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, createStore } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectResponse } from "@bb/server-contract";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { sdk } from "@/lib/sdk";
import {
  makeProjectResponse,
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import {
  ThreadActionCollectors,
  resetThreadActionRegistryForTest,
} from "@/lib/thread-actions/thread-action-registry";
import { ThreadActionsContextMenu } from "@/components/thread/ThreadActionsMenu";
import { ProjectActionsProvider } from "./ProjectActionsProvider";
import { ProjectActionsMenu } from "./ProjectActionsMenu";

vi.mock("@/lib/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sdk")>()),
  sdk: {
    projects: {
      update: vi.fn(),
      delete: vi.fn(),
      sources: { add: vi.fn(), delete: vi.fn() },
    },
    hosts: { list: vi.fn(), pickFolder: vi.fn() },
    system: { config: vi.fn() },
  },
}));
vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));
vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localDaemonHostId: "host_local",
    supportsNativeFolderPicker: true,
    platform: "darwin",
  }),
}));

let project: ProjectResponse;
function bootstrap() {
  return makeSidebarBootstrapResponse({
    projects: [makeProjectWithThreadsResponse(project)],
  });
}
function SdkButton() {
  const editProject =
    pluginSdkAppImplementation.experimental_useProjectEditor();
  return <button onClick={() => editProject(project.id)}>Open editor</button>;
}
const editAction = CORE_THREAD_ACTIONS.filter(
  (action) => action.id === "editProject",
);
const thread = {
  id: "thr_editor",
  projectId: "proj_editor",
  parentThreadId: null,
  archivedAt: null,
  pinnedAt: null,
  sectionId: null,
  isUnread: false,
  status: "idle" as const,
  environment: null,
};

function mount(surface: "project" | "thread" | "sdk" = "sdk", compact = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(sidebarNavigationQueryKey(), bootstrap());
  const container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={createStore()}>
        <MemoryRouter>
          <CompactViewportOverrideProvider isCompactViewport={compact}>
            <ProjectActionsProvider>
              {surface === "project" ? (
                <ProjectActionsMenu project={project} />
              ) : surface === "thread" ? (
                <>
                  <ThreadActionCollectors
                    coreRegistrations={editAction}
                    requestRename={() => {}}
                  />
                  <ThreadActionsContextMenu thread={thread}>
                    <div>Thread row</div>
                  </ThreadActionsContextMenu>
                </>
              ) : (
                <SdkButton />
              )}
            </ProjectActionsProvider>
          </CompactViewportOverrideProvider>
        </MemoryRouter>
      </Provider>
    </QueryClientProvider>,
    { container },
  );
  return container;
}

beforeEach(() => {
  project = makeProjectResponse({
    id: "proj_editor",
    name: "Product",
    sources: [
      {
        id: "src_local",
        projectId: "proj_editor",
        type: "local_path",
        hostId: "host_local",
        path: "/work/api",
        isDefault: true,
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: "src_remote",
        projectId: "proj_editor",
        type: "local_path",
        hostId: "host_remote",
        path: "/srv/api",
        isDefault: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes("/sidebar-bootstrap"))
        throw new Error(`Unexpected request ${url}`);
      return new Response(JSON.stringify(bootstrap()), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  vi.mocked(sdk.hosts.list).mockResolvedValue([
    makeHost({ id: "host_local", name: "MacBook", status: "connected" }),
    makeHost({
      id: "host_remote",
      name: "Build server",
      status: "disconnected",
    }),
  ]);
  vi.mocked(sdk.system.config).mockResolvedValue(
    makeSystemConfig({ primaryHostId: "host_local" }),
  );
  vi.mocked(sdk.hosts.pickFolder).mockResolvedValue({ path: "/work/web" });
  vi.mocked(sdk.projects.update).mockImplementation(async ({ name }) => {
    project = { ...project, name: name ?? project.name };
    return project;
  });
  vi.mocked(sdk.projects.sources.add).mockImplementation(async (input) => {
    if (input.type !== "local_path") throw new Error("Unexpected clone");
    const source = {
      ...project.sources[0],
      id: "src_added",
      hostId: input.hostId,
      path: input.path,
      isDefault: false,
    };
    project = { ...project, sources: [...project.sources, source] };
    return source;
  });
  vi.mocked(sdk.projects.sources.delete).mockImplementation(
    async ({ sourceId }) => {
      project = {
        ...project,
        sources: project.sources.filter((source) => source.id !== sourceId),
      };
      return { ok: true };
    },
  );
});
afterEach(() => {
  cleanup();
  document.getElementById("root")?.remove();
  window.localStorage.clear();
  resetThreadActionRegistryForTest();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("project editor", () => {
  it.each(["project", "thread", "sdk"] as const)(
    "opens the same folders through the %s surface",
    async (surface) => {
      mount(surface);
      if (surface === "project") {
        fireEvent.pointerDown(
          screen.getByRole("button", { name: "Product actions" }),
          { button: 0 },
        );
        fireEvent.click(
          await screen.findByRole("menuitem", { name: "Edit project…" }),
        );
      } else if (surface === "thread") {
        fireEvent.contextMenu(screen.getByText("Thread row"), {
          button: 2,
          clientX: 10,
          clientY: 10,
        });
        fireEvent.click(
          await screen.findByRole("menuitem", { name: "Edit project…" }),
        );
      } else
        fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
      const dialog = await screen.findByRole("dialog", {
        name: "Edit project",
      });
      expect(within(dialog).getByDisplayValue("Product")).toBeDefined();
      expect(within(dialog).getByText("/work/api")).toBeDefined();
      expect(within(dialog).getByText("/srv/api")).toBeDefined();
      await within(dialog).findByText("Build server");
      expect(within(dialog).getByText("MacBook")).toBeDefined();
      expect(within(dialog).getAllByText("api")).toHaveLength(2);
    },
  );

  it("renames, adds another folder, and detaches all folders without deleting the project", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit project" });
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Project name" }),
      { target: { value: "New product" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
    await waitFor(() =>
      expect(sdk.projects.update).toHaveBeenCalledWith({
        projectId: "proj_editor",
        name: "New product",
      }),
    );
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole("button", { name: "Add folder" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Add folder" }));
    await within(dialog).findByText("/work/web");
    expect(sdk.projects.sources.add).toHaveBeenCalledWith({
      projectId: "proj_editor",
      type: "local_path",
      hostId: "host_local",
      path: "/work/web",
    });
    for (const path of ["/work/api", "/srv/api", "/work/web"]) {
      const detach = within(dialog).getByRole("button", {
        name: `Detach ${path}`,
      });
      await waitFor(() => expect(detach.hasAttribute("disabled")).toBe(false));
      fireEvent.click(detach);
      await waitFor(() => expect(within(dialog).queryByText(path)).toBeNull());
    }
    expect(sdk.projects.delete).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/No folders attached/)).toBeDefined();
    expect(
      within(dialog)
        .getByRole("button", { name: "Add folder" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("keeps the existing folder and name visible after a failed detach", async () => {
    vi.mocked(sdk.projects.sources.delete).mockRejectedValueOnce(
      new Error("Folder could not be detached"),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit project" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Detach /work/api" }),
    );
    await within(dialog).findByRole("alert");
    expect(within(dialog).getByText("/work/api")).toBeDefined();
    expect(within(dialog).getByDisplayValue("Product")).toBeDefined();
  });

  it("uses the compact drawer without hiding the app root", async () => {
    const root = mount("sdk", true);
    fireEvent.click(screen.getByRole("button", { name: "Open editor" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit project" });
    await within(dialog).findByText("/work/api");
    expect(root.getAttribute("aria-hidden")).not.toBe("true");
    expect(root.hasAttribute("inert")).toBe(false);
  });
});
