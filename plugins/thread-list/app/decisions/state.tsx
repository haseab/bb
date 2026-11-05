import { useEffect, useMemo, useRef } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { threadListRpcContract } from "../../server.js";
import {
  DECISIONS_CHANGED_CHANNEL,
  quickDecisionsStateSchema,
  type QuickDecisionsState,
} from "../../shared/decisions.js";
import { preferenceValueAtom } from "../preferences/preferences-sync.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { ThreadComparator } from "../model/project-thread-groups.js";
import { useSidebarData } from "../model/use-sidebar-data.js";
import { sidebarCompletedSectionIdAtom } from "../preferences/atoms.js";
import { currentDecision, decisionComparator, decisionRank } from "./model.js";

export const quickDecisionsStateAtom = atom<QuickDecisionsState>({ items: [] });
const decisionsByIdAtom = atom(
  (get) =>
    new Map(
      get(quickDecisionsStateAtom).items.map((item) => [item.threadId, item]),
    ),
);
const enabledAtom = preferenceValueAtom("quickDecisions");

export function QuickDecisionsSync() {
  const rpc = useRpc<typeof threadListRpcContract>();
  const setState = useSetAtom(quickDecisionsStateAtom);
  const enabled = useAtomValue(enabledAtom);
  const revision = useRef(0);
  const { projects, status } = useSidebarData();
  const signature = JSON.stringify(
    projects.flatMap((project) =>
      project.threads.map((thread) => [
        thread.id,
        thread.sectionId,
        thread.parentThreadId,
        thread.status,
        thread.hasPendingInteraction,
        thread.latestAttentionAt,
        thread.archivedAt,
      ]),
    ),
  );
  useEffect(() => {
    if (status !== "ready") return;
    let live = true;
    const requestedAt = revision.current;
    if (!enabled) {
      setState({ items: [] });
      return;
    }
    void rpc
      .call("decisionsState", null)
      .then((result) => {
        const parsed = quickDecisionsStateSchema.safeParse(result);
        if (live && parsed.success && revision.current === requestedAt)
          setState(parsed.data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rpc, setState, enabled, status, signature]);
  useRealtime(DECISIONS_CHANGED_CHANNEL, (payload) => {
    const parsed = quickDecisionsStateSchema.safeParse(payload);
    if (enabled && parsed.success) {
      revision.current += 1;
      setState(parsed.data);
    }
  });
  return null;
}

export function useQuickDecision(
  thread: SidebarThread,
  hiddenChildren: readonly string[],
) {
  const byId = useAtomValue(decisionsByIdAtom);
  const enabled = useAtomValue(enabledAtom);
  const completed = useAtomValue(sidebarCompletedSectionIdAtom);
  if (!enabled || (thread.sectionId !== null && thread.sectionId === completed))
    return null;
  let decision = currentDecision(thread, byId.get(thread.id));
  for (const id of hiddenChildren) {
    const child = byId.get(id);
    if (child && decisionRank(child) > decisionRank(decision)) decision = child;
  }
  return decision;
}

export function useDecisionComparator(
  base: ThreadComparator,
  threads: readonly SidebarThread[],
) {
  const { items } = useAtomValue(quickDecisionsStateAtom);
  const enabled = useAtomValue(enabledAtom);
  return useMemo(
    () => (enabled ? decisionComparator(base, threads, items) : base),
    [base, threads, items, enabled],
  );
}
