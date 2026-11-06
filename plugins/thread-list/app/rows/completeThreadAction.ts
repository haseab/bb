import { useCallback } from "react";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import {
  experimental_THREAD_ACTION_GROUPS,
  useBbNavigate,
  useRpc,
  useSdk,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import type { threadListRpcContract } from "../../server.js";
import { sidebarCompletedSectionIdAtom } from "../preferences/atoms.js";
import {
  usePreferencesReady,
  usePreferencesSync,
} from "../preferences/PreferencesSync.js";
import { captureThreadPipelinePositions } from "../pipeline/threadPipelineAnimation.js";
import { useSidebarData } from "../model/use-sidebar-data.js";
import { collectVisibleThreadIds } from "../selection/threadSelection.js";
import { completionNextThreadId } from "./completionNextThread.js";

function focusThreadRow(threadId: string, attempts = 12): void {
  const link = [
    ...document.querySelectorAll<HTMLAnchorElement>(
      "a[data-sidebar-thread-id]",
    ),
  ].find((candidate) => candidate.dataset.sidebarThreadId === threadId);
  if (link) {
    link.focus({ preventScroll: true });
    link.scrollIntoView?.({ block: "nearest" });
  } else if (attempts > 0) {
    requestAnimationFrame(() => focusThreadRow(threadId, attempts - 1));
  }
}

export function useThreadCompletion() {
  usePreferencesSync();
  const ready = usePreferencesReady();
  const configuredSectionId = useAtomValue(sidebarCompletedSectionIdAtom);
  const rpc = useRpc<typeof threadListRpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const { projects, sections } = useSidebarData();
  const sectionId =
    configuredSectionId ??
    sections.find((section) => section.name.toLowerCase() === "completed")
      ?.id ??
    null;
  const setCompleted = useCallback(
    async (threadId: string, completed: boolean) => {
      const source = [
        ...document.querySelectorAll<HTMLAnchorElement>(
          "a[data-sidebar-thread-id]",
        ),
      ].find((link) => link.dataset.sidebarThreadId === threadId);
      const restoreSelector =
        source !== undefined &&
        (document.activeElement === source ||
          source.dataset.sidebarThreadCursor === "true");
      const nextThreadId =
        completed && source
          ? completionNextThreadId(
              threadId,
              collectVisibleThreadIds(source),
              projects.flatMap((project) => project.threads),
              sectionId,
            )
          : undefined;
      captureThreadPipelinePositions(!source);
      try {
        const previous = await sdk.threads.get({ threadId });
        await rpc.call("setCompleted", { threadId, completed });
        if (!completed && restoreSelector)
          navigate.toThread(threadId, { experimental_focusSidebar: true });
        else if (nextThreadId !== undefined) {
          if (nextThreadId === null) navigate.toCompose();
          else {
            navigate.toThread(nextThreadId);
            focusThreadRow(nextThreadId);
          }
        }
        toast.success(completed ? "Thread completed" : "Thread reopened", {
          id: `thread-completion-${threadId}`,
          description:
            previous.title ?? previous.titleFallback ?? "Untitled thread",
          duration: 10_000,
          cancel: {
            label: "Undo",
            onClick: () => {
              captureThreadPipelinePositions(!restoreSelector);
              void (async () => {
                try {
                  await sdk.threads.update({
                    threadId,
                    sectionId: previous.sectionId,
                    parentThreadId: previous.parentThreadId,
                  });
                  if (previous.pinnedAt !== null)
                    await sdk.threads.pin({ threadId });
                  if (restoreSelector)
                    navigate.toThread(threadId, {
                      experimental_focusSidebar: true,
                    });
                } catch {
                  toast.error("Failed to undo thread change.");
                }
              })();
            },
          },
        });
      } catch (error) {
        toast.error(
          completed ? "Failed to complete thread." : "Failed to reopen thread.",
        );
        throw error;
      }
    },
    [rpc, sdk, navigate, projects, sectionId],
  );
  return { ready, sectionId, setCompleted };
}

export const completeThreadAction: PluginThreadActionRegistration<
  ReturnType<typeof useThreadCompletion>
> = {
  id: "complete",
  title: "Complete",
  icon: "Check",
  group: experimental_THREAD_ACTION_GROUPS.lifecycle,
  order: 0,
  useData: useThreadCompletion,
  experimental_bulkItem: ({ threads, data }) => {
    const active = threads.filter((thread) => thread.archivedAt === null);
    if (active.length === 0) return null;
    const completed = active.every(
      (thread) =>
        data.sectionId !== null && thread.sectionId === data.sectionId,
    );
    return {
      label: `${completed ? "Reopen" : "Complete"} ${active.length} threads`,
      icon: completed ? "RotateCcw" : "Check",
      disabled: !data.ready,
      run: async () => {
        const results = await Promise.allSettled(
          active.map((thread) => data.setCompleted(thread.id, !completed)),
        );
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      },
    };
  },
  item: ({ thread, data }) => {
    if (thread.archivedAt !== null) return null;
    const completed =
      data.sectionId !== null && thread.sectionId === data.sectionId;
    return {
      label: completed ? "Reopen" : "Complete",
      icon: completed ? "RotateCcw" : "Check",
      disabled: !data.ready,
      run: () => data.setCompleted(thread.id, !completed),
    };
  },
};
