import type { SidebarThread } from "./sidebar-thread.js";

export function partitionCompletedThreads(
  threads: readonly SidebarThread[],
  sectionId: string | null,
) {
  if (sectionId === null) return { completed: [], remaining: threads };
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const isCompleted = (thread: SidebarThread) => {
    const seen = new Set<string>();
    let current: SidebarThread | undefined = thread;
    while (current && !seen.has(current.id)) {
      if (current.sectionId === sectionId) return true;
      seen.add(current.id);
      current =
        current.parentThreadId === null
          ? undefined
          : byId.get(current.parentThreadId);
    }
    return false;
  };
  const completed: SidebarThread[] = [];
  const remaining: SidebarThread[] = [];
  for (const thread of threads)
    (isCompleted(thread) ? completed : remaining).push(thread);
  return { completed, remaining };
}
