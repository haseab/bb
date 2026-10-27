import { useEffect } from "react";
import type { PluginCommandRegistration } from "@get-bb/plugin-sdk/app";
import { useSidebarData } from "../model/use-sidebar-data.js";
import { useThreadCompletion } from "../rows/completeThreadAction.js";

let complete: ((threadId: string) => Promise<void>) | null = null;
let available: ReadonlySet<string> = new Set();

export function focusedCompletionThreadId(): string | null {
  const focused = document.activeElement;
  if (
    !(focused instanceof HTMLElement) ||
    focused.closest(
      'input, textarea, [contenteditable="true"], [role="textbox"]',
    )
  )
    return null;
  return (
    focused
      .closest("a[data-sidebar-thread-id]")
      ?.getAttribute("data-sidebar-thread-id") ?? null
  );
}

export const threadCompletionCommand: PluginCommandRegistration = {
  id: "complete",
  title: "Complete selected thread",
  defaultShortcut: { key: "Enter", mod: true },
  isAvailable: () => {
    const threadId = focusedCompletionThreadId();
    return complete !== null && threadId !== null && available.has(threadId);
  },
  run: async () => {
    const threadId = focusedCompletionThreadId();
    if (threadId !== null && available.has(threadId))
      await complete?.(threadId);
  },
};

export function ThreadCompletionControls() {
  const { ready, sectionId, setCompleted } = useThreadCompletion();
  const { projects, status } = useSidebarData();
  useEffect(() => {
    const run = (threadId: string) => setCompleted(threadId, true);
    complete = run;
    available = new Set(
      ready && status === "ready"
        ? projects.flatMap((project) =>
            project.threads
              .filter(
                (thread) =>
                  thread.archivedAt === null &&
                  (sectionId === null || thread.sectionId !== sectionId),
              )
              .map((thread) => thread.id),
          )
        : [],
    );
    return () => {
      if (complete === run) {
        complete = null;
        available = new Set();
      }
    };
  }, [ready, sectionId, setCompleted, projects, status]);
  return null;
}
