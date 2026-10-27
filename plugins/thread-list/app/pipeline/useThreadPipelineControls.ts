import { useEffect, useLayoutEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { ThreadComparator } from "../model/project-thread-groups.js";
import { useMoveDestinations } from "../rows/moveThreadAction.js";
import { moveThreadToSection } from "../rows/moveThreadToSection.js";
import {
  sidebarManualThreadOrderAtom,
  sidebarChronologicalSortAtom,
  sidebarGroupByReadStatusAtom,
  sidebarOrganizationModeAtom,
  collapsedThreadIdsAtom,
  collapsedSidebarSectionIdsAtom,
  sidebarCollapsedThreadSectionsAtom,
} from "../preferences/atoms.js";
import {
  bindThreadPipelineHandler,
  type ThreadPipelineAction,
} from "./threadPipelineCommands.js";
import {
  animateThreadPipelinePositions,
  captureThreadPipelinePositions,
} from "./threadPipelineAnimation.js";

export function useThreadPipelineControls({
  threads,
  comparator,
  ready,
}: {
  threads: readonly SidebarThread[];
  comparator: ThreadComparator;
  ready: boolean;
}): void {
  const sdk = useSdk();
  const destinations = useMoveDestinations();
  const mode = useAtomValue(sidebarOrganizationModeAtom);
  const [order, setOrder] = useAtom(sidebarManualThreadOrderAtom);
  const setSort = useSetAtom(sidebarChronologicalSortAtom);
  const setGroupByReadStatus = useSetAtom(sidebarGroupByReadStatusAtom);
  const setCollapsedThreads = useSetAtom(collapsedThreadIdsAtom);
  const setCollapsedSections = useSetAtom(collapsedSidebarSectionIdsAtom);
  const setCollapsedCustomSections = useSetAtom(
    sidebarCollapsedThreadSectionsAtom,
  );
  const latest = useRef({
    threads,
    comparator,
    destinations,
    ready,
    mode,
    order,
  });
  useLayoutEffect(() => {
    latest.current = { threads, comparator, destinations, ready, mode, order };
    animateThreadPipelinePositions();
  });
  useEffect(() => {
    let pending = Promise.resolve();
    const perform = async (threadId: string, action: ThreadPipelineAction) => {
      const state = latest.current;
      const thread = state.threads.find(
        (candidate) => candidate.id === threadId,
      );
      if (
        !thread ||
        !state.destinations ||
        !state.ready ||
        state.mode !== "chronological" ||
        thread.archivedAt !== null
      )
        return;
      const direction = action.endsWith("up") ? -1 : 1;
      if (action.startsWith("section")) {
        const index = state.destinations.findIndex(
          (destination) => destination.sectionId === thread.sectionId,
        );
        if (index === -1) return;
        const destination = state.destinations[index + direction];
        if (!destination) return;
        captureThreadPipelinePositions();
        if (destination.sectionId === null)
          setCollapsedSections((ids) => ids.filter((id) => id !== "threads"));
        else
          setCollapsedCustomSections((ids) =>
            ids.filter((id) => id !== destination.sectionId),
          );
        await moveThreadToSection(sdk, thread, destination.sectionId);
        latest.current = {
          ...latest.current,
          threads: latest.current.threads.map((candidate) =>
            candidate.id === thread.id
              ? {
                  ...candidate,
                  sectionId: destination.sectionId,
                  parentThreadId: null,
                  pinnedAt: null,
                }
              : candidate,
          ),
        };
      } else {
        const siblings = state.threads
          .filter(
            (candidate) =>
              candidate.archivedAt === null &&
              (thread.pinnedAt !== null ||
                candidate.sectionId === thread.sectionId) &&
              candidate.parentThreadId === thread.parentThreadId &&
              (candidate.pinnedAt !== null) === (thread.pinnedAt !== null),
          )
          .sort(
            thread.pinnedAt === null
              ? state.comparator
              : (a, b) =>
                  (a.pinSortKey ?? "").localeCompare(b.pinSortKey ?? ""),
          );
        const index = siblings.findIndex(
          (candidate) => candidate.id === thread.id,
        );
        const next = index + direction;
        if (index === -1 || next < 0 || next >= siblings.length) return;
        captureThreadPipelinePositions();
        [siblings[index], siblings[next]] = [siblings[next], siblings[index]];
        if (thread.pinnedAt !== null) {
          await sdk.threads.reorderPinned({
            threadId: thread.id,
            previousThreadId: siblings[next - 1]?.id ?? null,
            nextThreadId: siblings[next + 1]?.id ?? null,
          });
        } else {
          const rest = state.order.filter(
            (id) => !siblings.some((sibling) => sibling.id === id),
          );
          const nextOrder = [...siblings.map((sibling) => sibling.id), ...rest];
          const positions = new Map(nextOrder.map((id, index) => [id, index]));
          latest.current = {
            ...latest.current,
            order: nextOrder,
            comparator: (left, right) =>
              (positions.get(left.id) ?? nextOrder.length) -
                (positions.get(right.id) ?? nextOrder.length) ||
              state.comparator(left, right),
          };
          setOrder(nextOrder);
          setSort("manual");
          setGroupByReadStatus(false);
        }
        if (thread.parentThreadId !== null)
          setCollapsedThreads((ids) =>
            ids.filter((id) => id !== thread.parentThreadId),
          );
      }
    };
    return bindThreadPipelineHandler({
      canRun: (threadId) =>
        latest.current.ready &&
        latest.current.mode === "chronological" &&
        latest.current.threads.some(
          (thread) => thread.id === threadId && thread.archivedAt === null,
        ),
      run: (threadId, action) => {
        pending = pending
          .then(() => perform(threadId, action))
          .catch(() => {
            toast.error("Failed to move thread.");
          });
        return pending;
      },
    });
  }, [
    sdk,
    setOrder,
    setSort,
    setGroupByReadStatus,
    setCollapsedThreads,
    setCollapsedSections,
    setCollapsedCustomSections,
  ]);
}
