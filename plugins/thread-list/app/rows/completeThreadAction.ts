import { useCallback } from "react";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import {
  experimental_THREAD_ACTION_GROUPS,
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

export function useThreadCompletion() {
  usePreferencesSync();
  const ready = usePreferencesReady();
  const sectionId = useAtomValue(sidebarCompletedSectionIdAtom);
  const rpc = useRpc<typeof threadListRpcContract>();
  const sdk = useSdk();
  const setCompleted = useCallback(
    async (threadId: string, completed: boolean) => {
      captureThreadPipelinePositions();
      try {
        const previous = await sdk.threads.get({ threadId });
        await rpc.call("setCompleted", { threadId, completed });
        toast.success(completed ? "Thread completed" : "Thread reopened", {
          id: `thread-completion-${threadId}`,
          description:
            previous.title ?? previous.titleFallback ?? "Untitled thread",
          duration: 10_000,
          cancel: {
            label: "Undo",
            onClick: () => {
              captureThreadPipelinePositions();
              void (async () => {
                try {
                  await sdk.threads.update({
                    threadId,
                    sectionId: previous.sectionId,
                    parentThreadId: previous.parentThreadId,
                  });
                  if (previous.pinnedAt !== null)
                    await sdk.threads.pin({ threadId });
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
    [rpc, sdk],
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
