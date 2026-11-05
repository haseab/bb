// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  makeThreadListEntry,
  makeThread,
} from "@bb/test-helpers/domain-fixtures";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { createInMemoryThreadPreview } from "./in-memory-thread-preview";

function setup() {
  const source = makeSidebarBootstrapResponse({
    projects: [
      makeProjectWithThreadsResponse({
        threads: [
          ...Array.from({ length: 12 }, (_, i) =>
            makeThreadListEntry({
              id: `thread-${i}`,
              title: `Actual conversation ${i}`,
            }),
          ),
          makeThreadListEntry({
            id: "badge",
            title: "Badge preview — general",
          }),
        ],
      }),
    ],
  });
  const network = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      location.origin,
    ).pathname;
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method !== "GET")
      throw new Error(`Unexpected server write: ${method} ${path}`);
    return Response.json(
      path.endsWith("sidebar-bootstrap")
        ? source
        : makeThread({ id: path.split("/").at(-1) }),
    );
  });
  const changed = vi.fn();
  return {
    source,
    network,
    changed,
    preview: createInMemoryThreadPreview(network, changed),
  };
}
const rpc = (name: string, input: unknown) => ({
  url: `/api/v1/plugins/thread-list/rpc/${name}`,
  init: {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
  },
});

describe("in-memory conversation preview", () => {
  it("uses actual conversations and keeps updates, scheduling and completion off the server", async () => {
    const { preview, network, source, changed } = setup();
    const sidebar = await (await preview("/api/v1/sidebar-bootstrap")).json();
    expect(sidebar.projects[0].threads).toHaveLength(12);
    expect(
      sidebar.projects[0].threads.some(
        (thread: { id: string }) => thread.id === "badge",
      ),
    ).toBe(false);
    await preview("/api/v1/threads/thread-4", {
      method: "PATCH",
      body: JSON.stringify({ title: "Memory only" }),
    });
    const schedule = rpc("scheduleFollowUp", {
      threadId: "thread-4",
      input: "61 min",
      timeZone: "UTC",
      onlyBacklog: true,
    });
    const result = await (await preview(schedule.url, schedule.init)).json();
    expect(
      result.result.items.find(
        (item: { threadId: string }) => item.threadId === "thread-4",
      ).followUpAt,
    ).toBeGreaterThan(Date.now());
    const complete = rpc("setCompleted", {
      threadId: "thread-5",
      completed: true,
    });
    await preview(complete.url, complete.init);
    await preview("/api/v1/threads/thread-4/pin", { method: "POST" });
    expect(changed).toHaveBeenCalled();
    expect(source.projects[0].threads[4].title).toBe("Actual conversation 4");
    expect(network.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
      true,
    );
    const reset = createInMemoryThreadPreview(network);
    const fresh = await (await reset("/api/v1/sidebar-bootstrap")).json();
    expect(fresh.projects[0].threads[4].title).toBe("Actual conversation 4");
  });
  it.each([
    "/api/v1/threads/thread-4/messages",
    "/api/v1/threads/thread-4/run",
    "/api/v1/plugins/other/rpc/save",
  ])("blocks unsupported writes to %s", async (url) => {
    const { preview, network } = setup();
    expect(
      (
        await preview(
          new Request(new URL(url, location.origin), {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(409);
    expect(network).not.toHaveBeenCalled();
  });
});
