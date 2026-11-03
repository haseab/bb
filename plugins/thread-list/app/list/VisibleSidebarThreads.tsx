import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { ThreadRow } from "../rows/ThreadRow.js";
import type { ThreadSplitIndicatorTarget } from "./groupRollups.js";

const ActiveSidebarThreadContext = createContext<string | null>(null);

export const VisibleSidebarThreadsContext = createContext<
  readonly SidebarThread[]
>([]);

export function useVisibleSidebarThreads(
  threads: readonly ThreadSplitIndicatorTarget[],
) {
  const visible = useContext(VisibleSidebarThreadsContext);
  const ids = new Set(threads.map((thread) => thread.id));
  return visible.filter((thread) => ids.has(thread.id));
}

export function VisibleSidebarThreadsProvider({
  threads,
  activeThreadId,
  children,
}: {
  threads: readonly SidebarThread[];
  activeThreadId: string | null;
  children: ReactNode;
}) {
  const layout = useSidebarSplitLayout();
  const visible = useMemo(() => {
    const ids = new Set(layout?.panes.map((pane) => pane.threadId) ?? []);
    if (activeThreadId !== null) ids.add(activeThreadId);
    return threads.filter((thread) => ids.has(thread.id));
  }, [threads, activeThreadId, layout]);
  return (
    <ActiveSidebarThreadContext.Provider value={activeThreadId}>
      <VisibleSidebarThreadsContext.Provider value={visible}>
        {children}
      </VisibleSidebarThreadsContext.Provider>
    </ActiveSidebarThreadContext.Provider>
  );
}

export function VisibleSidebarThreads({
  threads,
  onShowAll,
  depth = 0,
  label,
}: {
  threads: readonly ThreadSplitIndicatorTarget[];
  onShowAll: () => void;
  depth?: number;
  label: string;
}) {
  const visible = useVisibleSidebarThreads(threads);
  const threadId = useContext(ActiveSidebarThreadContext);
  if (visible.length === 0) return null;
  return (
    <div className="mt-1 space-y-px" data-sidebar-visible-threads="">
      {visible.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          crossProjectId={thread.projectId}
          isActive={thread.id === threadId}
          options={{ kind: "default", depth, isCompact: false }}
        />
      ))}
      {threads.some(
        (thread) => !visible.some((shown) => shown.id === thread.id),
      ) && (
        <button
          type="button"
          className="w-full rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={`Show all ${label}`}
          onClick={onShowAll}
        >
          Show all
        </button>
      )}
    </div>
  );
}
