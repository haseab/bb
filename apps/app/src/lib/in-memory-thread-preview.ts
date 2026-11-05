import {
  sidebarBootstrapResponseSchema,
  updateThreadRequestSchema,
  type SidebarBootstrapResponse,
} from "@bb/server-contract";
import type { ThreadListEntry } from "@bb/domain";
import {
  backlogRpcContract,
  type BacklogState,
} from "bb-plugin-thread-list/shared/backlog.js";
import { parseFollowUpDate } from "bb-plugin-thread-list/shared/follow-up-date.js";
import { z } from "zod";

export function isInMemoryThreadPreview(): boolean {
  return (
    import.meta.env.DEV &&
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("preview") === "backlog"
  );
}

export function createInMemoryThreadPreview(
  network: typeof fetch,
  onChange?: (data: SidebarBootstrapResponse) => void,
): typeof fetch {
  let bootstrap: SidebarBootstrapResponse | null = null;
  let loading: Promise<SidebarBootstrapResponse> | null = null;
  let backlog: BacklogState = { sectionId: null, items: [] };
  const patches = new Map<string, Partial<ThreadListEntry>>();
  const preferences: Record<string, unknown> = {
    collapsedSections: [],
    collapsedThreadSections: [],
  };
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status });
  const rpcResult = (result: unknown) => json({ ok: true, result });
  const blocked = () =>
    json(
      {
        error:
          "This is an in-memory preview. Runs and unsupported writes are disabled; refresh to reset preview changes.",
      },
      409,
    );
  const load = async () => {
    if (bootstrap) return bootstrap;
    loading ??= network("/api/v1/sidebar-bootstrap", { method: "GET" }).then(
      async (response) => {
        if (!response.ok)
          throw new Error("Could not load conversations for preview");
        const data = sidebarBootstrapResponseSchema.parse(
          await response.json(),
        );
        const sections = ["Active", "Backlog", "Completed"].map(
          (name) =>
            data.sections.find(
              (section) => section.name.toLowerCase() === name.toLowerCase(),
            ) ?? {
              id: `preview-${name.toLowerCase()}`,
              name,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
        );
        for (const section of sections)
          if (!data.sections.some((existing) => existing.id === section.id))
            data.sections.push(section);
        const [active, backlogSection, completed] = sections;
        const projects = [...data.projects, data.personalProject];
        for (const project of projects)
          project.threads = project.threads.filter(
            (thread) =>
              !(thread.title ?? thread.titleFallback ?? "").startsWith(
                "Badge preview",
              ),
          );
        const roots = projects
          .flatMap((project) => project.threads)
          .filter(
            (thread) =>
              thread.parentThreadId === null &&
              thread.archivedAt === null &&
              thread.pinnedAt === null &&
              thread.status !== "active",
          );
        const now = Date.now();
        backlog.sectionId = backlogSection.id;
        roots.slice(0, 9).forEach((thread, index) => {
          const sectionId =
            index < 2
              ? completed.id
              : index < 4
                ? active.id
                : index < 7
                  ? backlogSection.id
                  : null;
          patches.set(thread.id, { sectionId });
          if (index >= 4)
            backlog.items.push({
              threadId: thread.id,
              sectionId: backlogSection.id,
              enteredAt: now,
              followUpAt: null,
              refreshAt: now + 7 * 86400000,
              refreshedAt: index >= 7 ? now + index : null,
              stage: index >= 7 ? "refreshed" : "backlog",
            });
        });
        bootstrap = data;
        return data;
      },
    );
    return loading;
  };
  const sidebar = async () => {
    const data = await load();
    const project = (value: SidebarBootstrapResponse["personalProject"]) => ({
      ...value,
      threads: value.threads.map((thread) => ({
        ...thread,
        ...patches.get(thread.id),
      })),
    });
    return {
      ...data,
      projects: data.projects.map(project),
      personalProject: project(data.personalProject),
    };
  };
  return async (input, init) => {
    const request = new Request(
      input instanceof Request
        ? input.clone()
        : new URL(String(input), location.origin),
      init,
    );
    const url = new URL(request.url);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/"))
      return network(input, init);
    const method = request.method;
    const path = url.pathname;
    if (method === "GET" && path === "/api/v1/sidebar-bootstrap")
      return json(await sidebar());
    const action = path.match(
      /^\/api\/v1\/threads\/([^/]+)\/(read|unread|pin|unpin|archive-all|unarchive)$/,
    );
    if (action && method === "POST") {
      await load();
      const [id, verb] = action.slice(1);
      const now = Date.now();
      const patch =
        verb === "pin" || verb === "unpin"
          ? { pinnedAt: verb === "pin" ? now : null }
          : verb === "read" || verb === "unread"
            ? { lastReadAt: verb === "read" ? now : null }
            : { archivedAt: verb === "archive-all" ? now : null };
      patches.set(id, { ...patches.get(id), ...patch });
      onChange?.(await sidebar());
      if (verb === "archive-all")
        return json({ ok: true, archivedThreadIds: [id] });
      if (verb === "unarchive") return json({ ok: true });
      const response = await network(
        new URL(`/api/v1/threads/${id}`, url.origin),
        { method: "GET" },
      );
      if (!response.ok) return response;
      return json({
        ...z.record(z.string(), z.unknown()).parse(await response.json()),
        ...patches.get(id),
      });
    }
    const thread = path.match(/^\/api\/v1\/threads\/([^/]+)$/);
    if (thread && (method === "GET" || method === "PATCH")) {
      await load();
      if (method === "PATCH")
        patches.set(thread[1], {
          ...patches.get(thread[1]),
          ...updateThreadRequestSchema.parse(await request.json()),
        });
      if (method === "PATCH") onChange?.(await sidebar());
      const response = await network(new URL(path, url.origin), {
        method: "GET",
      });
      if (!response.ok) return response;
      const original: unknown = await response.json();
      return json({
        ...z.record(z.string(), z.unknown()).parse(original),
        ...patches.get(thread[1]),
      });
    }
    const rpc = path.match(/^\/api\/v1\/plugins\/thread-list\/rpc\/([^/]+)$/);
    if (rpc && method === "POST") {
      const name = rpc[1];
      if (name === "listPreferences") {
        const response = await network(input, init);
        const result = z
          .object({
            result: z.object({
              preferences: z.record(z.string(), z.unknown()),
            }),
          })
          .parse(await response.json());
        return rpcResult({
          preferences: { ...result.result.preferences, ...preferences },
        });
      }
      await load();
      if (name === "backlogState") return rpcResult(backlog);
      if (name === "scheduleFollowUp") {
        const args = backlogRpcContract.scheduleFollowUp.input.parse(
          await request.json(),
        );
        const at = parseFollowUpDate(args.input, Date.now(), args.timeZone);
        if (at === null)
          return json({ error: "Enter a future date or duration." }, 400);
        const sectionId = backlog.sectionId!;
        patches.set(args.threadId, {
          ...patches.get(args.threadId),
          sectionId,
        });
        backlog = {
          ...backlog,
          items: [
            ...backlog.items.filter((item) => item.threadId !== args.threadId),
            {
              threadId: args.threadId,
              sectionId,
              enteredAt: Date.now(),
              followUpAt: at,
              refreshAt: at,
              refreshedAt: null,
              stage: "backlog",
            },
          ],
        };
        onChange?.(await sidebar());
        return rpcResult(backlog);
      }
      if (name === "clearFollowUp") {
        const args = backlogRpcContract.clearFollowUp.input.parse(
          await request.json(),
        );
        backlog = {
          ...backlog,
          items: backlog.items.map((item) =>
            item.threadId === args.threadId
              ? {
                  ...item,
                  followUpAt: null,
                  refreshAt: Date.now() + 7 * 86400000,
                }
              : item,
          ),
        };
        onChange?.(await sidebar());
        return rpcResult(backlog);
      }
      if (name === "setPreference") {
        const args = z
          .object({ key: z.string(), value: z.unknown() })
          .parse(await request.json());
        preferences[args.key] = args.value;
        return rpcResult(args);
      }
      if (name === "setCompleted") {
        const args = z
          .object({ threadId: z.string(), completed: z.boolean() })
          .parse(await request.json());
        const sectionId = args.completed
          ? bootstrap!.sections.find(
              (section) => section.name.toLowerCase() === "completed",
            )!.id
          : null;
        patches.set(args.threadId, {
          ...patches.get(args.threadId),
          sectionId,
        });
        onChange?.(await sidebar());
        return rpcResult({ threadId: args.threadId, sectionId });
      }
      return blocked();
    }
    if (method === "GET" || method === "HEAD" || method === "OPTIONS")
      return network(input, init);
    return blocked();
  };
}

export function installInMemoryThreadPreview(
  onChange: (data: SidebarBootstrapResponse) => void,
): void {
  if (!isInMemoryThreadPreview()) return;
  window.fetch = createInMemoryThreadPreview(
    window.fetch.bind(window),
    onChange,
  );
  Storage.prototype.setItem = () => {};
  Storage.prototype.removeItem = () => {};
  Storage.prototype.clear = () => {};
  const badge = document.createElement("div");
  badge.textContent = "Preview · changes reset on refresh";
  badge.className =
    "fixed right-4 top-12 z-[100] rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm";
  document.body.append(badge);
}
