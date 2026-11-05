import type { SidebarThread } from "../model/sidebar-thread.js";

export function completionNextThreadId(
  threadId: string,
  order: readonly string[],
  threads: readonly SidebarThread[],
  completedSectionId: string | null,
): string | null {
  const index = order.indexOf(threadId);
  if (index === -1) return null;
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const eligible = (id: string) => {
    const thread = byId.get(id);
    if (
      !thread ||
      thread.archivedAt !== null ||
      (completedSectionId !== null && thread.sectionId === completedSectionId)
    )
      return false;
    let parentId = thread.parentThreadId;
    const seen = new Set<string>();
    while (parentId !== null && !seen.has(parentId)) {
      if (parentId === threadId) return false;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentThreadId ?? null;
    }
    return true;
  };
  return (
    order.slice(index + 1).find(eligible) ??
    order.slice(0, index).reverse().find(eligible) ??
    null
  );
}
