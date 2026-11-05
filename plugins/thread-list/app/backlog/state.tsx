import { useEffect, useMemo } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { threadListRpcContract } from "../../server.js";
import {
  BACKLOG_CHANGED_CHANNEL,
  backlogStateSchema,
  type BacklogState,
} from "../../shared/backlog.js";
import { useSidebarData } from "../model/use-sidebar-data.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type {
  ProjectThreadItem,
  ThreadComparator,
} from "../model/project-thread-groups.js";

export const backlogStateAtom = atom<BacklogState>({
  sectionId: null,
  items: [],
});
export const refreshedThreadIdsAtom = atom(
  (get) =>
    new Set(
      get(backlogStateAtom)
        .items.filter(
          (item) => item.stage === "refreshed" || item.stage === "refreshing",
        )
        .map((item) => item.threadId),
    ),
);

export function BacklogSync() {
  const rpc = useRpc<typeof threadListRpcContract>();
  const setState = useSetAtom(backlogStateAtom);
  const { projects, sections, status } = useSidebarData();
  const signature = JSON.stringify({
    sections: sections.map(({ id, name }) => [id, name]),
    threads: projects.flatMap((project) =>
      project.threads.map((thread) => [
        thread.id,
        thread.sectionId,
        thread.parentThreadId,
        thread.pinnedAt,
        thread.archivedAt,
        thread.status,
      ]),
    ),
  });
  useEffect(() => {
    if (status !== "ready") return;
    let live = true;
    void rpc
      .call("backlogState", null)
      .then((result) => {
        const parsed = backlogStateSchema.safeParse(result);
        if (live && parsed.success) setState(parsed.data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rpc, signature, status, setState]);
  useRealtime(BACKLOG_CHANGED_CHANNEL, (payload) => {
    const parsed = backlogStateSchema.safeParse(payload);
    if (parsed.success) setState(parsed.data);
  });
  return null;
}

export function useRefreshedQueueComparator(
  base: ThreadComparator,
  threads: readonly SidebarThread[],
): ThreadComparator {
  const state = useAtomValue(backlogStateAtom);
  return useMemo(() => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const times = new Map(
      state.items
        .filter(
          (item) => item.stage === "refreshed" || item.stage === "refreshing",
        )
        .map((item) => [item.threadId, item.refreshedAt ?? item.refreshAt]),
    );
    const rank = (thread: SidebarThread): number | null => {
      const visited = new Set<string>();
      let current: SidebarThread | undefined = thread;
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const time = times.get(current.id);
        if (
          time !== undefined &&
          current.sectionId === null &&
          current.pinnedAt === null
        )
          return time;
        current =
          current.parentThreadId === null
            ? undefined
            : byId.get(current.parentThreadId);
      }
      return null;
    };
    if (!times.size) return base;
    const compare: ThreadComparator = (left, right) => {
      const a = rank(left);
      const b = rank(right);
      return (
        Number(a !== null) - Number(b !== null) ||
        (a !== null && b !== null ? a - b : 0) ||
        base(left, right)
      );
    };
    compare.separateEnvironmentThread = (thread) => rank(thread) !== null;
    const compareItems = base.compareItems;
    if (compareItems) {
      const first = (item: ProjectThreadItem): SidebarThread | null =>
        item.kind === "thread"
          ? item.node.thread
          : item.kind === "environment"
            ? item.group.nodes[0].thread
            : null;
      compare.compareItems = (left, right) => {
        const a = first(left);
        const b = first(right);
        if (!a || !b) return compareItems(left, right);
        const aRank = rank(a);
        const bRank = rank(b);
        return (
          Number(aRank !== null) - Number(bRank !== null) ||
          (aRank !== null && bRank !== null ? aRank - bRank : 0) ||
          compareItems(left, right)
        );
      };
    }
    return compare;
  }, [base, state.items, threads]);
}

export function RefreshedQueueDivider({
  items,
  index,
}: {
  items: readonly ProjectThreadItem[];
  index: number;
}) {
  const refreshed = useAtomValue(refreshedThreadIdsAtom);
  const isRefreshed = (item: ProjectThreadItem | undefined) =>
    item?.kind === "thread" &&
    item.node.thread.sectionId === null &&
    item.node.thread.pinnedAt === null &&
    item.node.thread.parentThreadId === null &&
    refreshed.has(item.node.thread.id);
  if (!isRefreshed(items[index]) || isRefreshed(items[index - 1])) return null;
  return (
    <div
      role="separator"
      aria-label="Refreshed queue"
      data-refreshed-queue-divider=""
      className="my-2 flex items-center gap-2 text-2xs text-muted-foreground"
    >
      <span className="h-px flex-1 bg-border" />
      <span>Refreshed</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
