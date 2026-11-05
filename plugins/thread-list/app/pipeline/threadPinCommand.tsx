import { useEffect } from "react";
import { toast } from "sonner";
import { useSdk, type PluginCommandRegistration } from "@get-bb/plugin-sdk/app";
import { useSidebarData } from "../model/use-sidebar-data.js";
import { focusedSidebarThreadId } from "./focusedSidebarThreadId.js";
import { captureThreadPipelinePositions } from "./threadPipelineAnimation.js";

let togglePin: ((threadId: string) => Promise<void>) | null = null;
let available: ReadonlySet<string> = new Set();
let pending = false;

function canToggleSelectedPin(): boolean {
  const id = focusedSidebarThreadId();
  return !pending && togglePin !== null && id !== null && available.has(id);
}

async function toggleSelectedPin(): Promise<void> {
  const id = focusedSidebarThreadId();
  if (pending || id === null || !available.has(id) || togglePin === null)
    return;
  pending = true;
  try {
    await togglePin(id);
  } finally {
    pending = false;
  }
}

export const threadPinCommand: PluginCommandRegistration = {
  id: "pin",
  title: "Pin or unpin selected thread",
  isAvailable: canToggleSelectedPin,
  run: toggleSelectedPin,
};

export function ThreadPinControls() {
  const sdk = useSdk();
  const { projects, status } = useSidebarData();
  useEffect(() => {
    const run = async (threadId: string) => {
      try {
        const thread = await sdk.threads.get({ threadId });
        if (thread.archivedAt !== null || thread.deletedAt !== null) return;
        captureThreadPipelinePositions();
        if (thread.pinnedAt === null) await sdk.threads.pin({ threadId });
        else await sdk.threads.unpin({ threadId });
      } catch {
        toast.error("Failed to change thread pin.");
      }
    };
    togglePin = run;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "p" ||
        !canToggleSelectedPin()
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void toggleSelectedPin();
    };
    document.addEventListener("keydown", keydown);
    available = new Set(
      status === "ready"
        ? projects.flatMap((project) =>
            project.threads
              .filter((thread) => thread.archivedAt === null)
              .map((thread) => thread.id),
          )
        : [],
    );
    return () => {
      document.removeEventListener("keydown", keydown);
      if (togglePin === run) {
        togglePin = null;
        available = new Set();
      }
    };
  }, [sdk, projects, status]);
  return null;
}
