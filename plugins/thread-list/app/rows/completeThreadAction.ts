import { useCallback } from "react";
import { useAtomValue } from "jotai";
import { toast } from "sonner";
import {
  experimental_THREAD_ACTION_GROUPS,
  useRpc,
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
  const setCompleted = useCallback(
    async (threadId: string, completed: boolean) => {
      captureThreadPipelinePositions();
      try {
        await rpc.call("setCompleted", { threadId, completed });
      } catch (error) {
        toast.error(
          completed ? "Failed to complete thread." : "Failed to reopen thread.",
        );
        throw error;
      }
    },
    [rpc],
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
