import {
  definePluginApp,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PreferencesSync } from "./app/preferences/PreferencesSync.js";
import { ProjectList } from "./app/list/ProjectList.js";
import { useSidebarThreadReveal } from "./app/list/useSidebarThreadReveal.js";
import { completeThreadAction } from "./app/rows/completeThreadAction.js";
import {
  ThreadCompletionControls,
  threadCompletionCommand,
} from "./app/pipeline/threadCompletionCommand.js";
import { moveThreadAction } from "./app/rows/moveThreadAction.js";
import { ThreadSelectionProvider } from "./app/selection/threadSelection.js";

import { threadPipelineCommands } from "./app/pipeline/threadPipelineCommands.js";

function ThreadList({
  activeThreadId,
  isCompactViewport,
  onNavigate,
}: PluginThreadListProps) {
  useSidebarThreadReveal();
  return (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <TooltipProvider>
        <PreferencesSync />
        <ThreadCompletionControls />
        <ThreadSelectionProvider activeThreadId={activeThreadId}>
          <ProjectList
            activeThreadId={activeThreadId}
            onProjectSelect={onNavigate}
          />
        </ThreadSelectionProvider>
      </TooltipProvider>
    </CompactViewportOverrideProvider>
  );
}

export default definePluginApp((app) => {
  app.commands.register(threadCompletionCommand);
  for (const command of threadPipelineCommands) app.commands.register(command);
  app.slots.experimental_threadList({
    id: "thread-list",
    title: "Thread list",
    description:
      "Pinned threads, custom sections, projects, machines, and nested threads.",
    component: ThreadList,
  });
  app.slots.experimental_threadAction(moveThreadAction);
  app.slots.experimental_threadAction(completeThreadAction);
});
