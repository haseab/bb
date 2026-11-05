import type { QuickDecision } from "../../shared/decisions.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type {
  ProjectThreadItem,
  ThreadComparator,
} from "../model/project-thread-groups.js";

export function decisionRank(
  decision: QuickDecision | null | undefined,
): number {
  return decision?.level === "instant"
    ? 2
    : decision?.level === "quick"
      ? 1
      : 0;
}

export function currentDecision(
  thread: SidebarThread,
  decision: QuickDecision | undefined,
): QuickDecision | null {
  if (
    !decision ||
    !decisionRank(decision) ||
    thread.archivedAt !== null ||
    thread.status === "error"
  )
    return null;
  if (decision.interactionId !== null)
    return thread.hasPendingInteraction ? decision : null;
  return thread.status === "idle" &&
    decision.requestKey.startsWith(`idle:${thread.latestAttentionAt}:`)
    ? decision
    : null;
}

export function decisionComparator(
  base: ThreadComparator,
  threads: readonly SidebarThread[],
  items: readonly QuickDecision[],
): ThreadComparator {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const ranks = new Map<string, number>();
  for (const item of items) {
    const thread = byId.get(item.threadId);
    if (!thread || !currentDecision(thread, item)) continue;
    const visited = new Set<string>();
    let current: SidebarThread | undefined = thread;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.sectionId !== null || current.pinnedAt !== null) break;
      ranks.set(
        current.id,
        Math.max(ranks.get(current.id) ?? 0, decisionRank(item)),
      );
      current =
        current.parentThreadId === null
          ? undefined
          : byId.get(current.parentThreadId);
    }
  }
  if (!ranks.size) return base;
  const rank = (thread: SidebarThread) => ranks.get(thread.id) ?? 0;
  const compare: ThreadComparator = (left, right) =>
    rank(right) - rank(left) || base(left, right);
  compare.separateEnvironmentThread = (thread) =>
    rank(thread) > 0 || (base.separateEnvironmentThread?.(thread) ?? false);
  const itemRank = (item: ProjectThreadItem): number =>
    item.kind === "thread"
      ? rank(item.node.thread)
      : item.kind === "environment"
        ? Math.max(0, ...item.group.nodes.map((node) => rank(node.thread)))
        : Math.max(0, ...item.group.items.map(itemRank));
  if (base.compareItems) {
    const compareItems = base.compareItems;
    compare.compareItems = (left, right) =>
      itemRank(right) - itemRank(left) || compareItems(left, right);
  }
  return compare;
}
