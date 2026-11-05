import { QuickDecisionsSync } from "./app/decisions/state.js";
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
import {
  ThreadPinControls,
  threadPinCommand,
} from "./app/pipeline/threadPinCommand.js";
import { moveThreadAction } from "./app/rows/moveThreadAction.js";
import { ThreadSelectionProvider } from "./app/selection/threadSelection.js";

import { threadPipelineCommands } from "./app/pipeline/threadPipelineCommands.js";

import { BacklogSync } from "./app/backlog/state.js";
import {
  BacklogTriage,
  backlogTriageCommand,
  followUpThreadAction,
} from "./app/backlog/BacklogTriage.js";

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
        <BacklogSync />
        <QuickDecisionsSync />
        <BacklogTriage />
        <ThreadCompletionControls />
        <ThreadPinControls />
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
  app.commands.register(backlogTriageCommand);
  app.commands.register(threadPinCommand);
  for (const command of threadPipelineCommands) app.commands.register(command);
  app.slots.experimental_threadList({
    id: "thread-list",
    title: "Thread list",
    description:
      "Pinned threads, custom sections, projects, machines, and nested threads.",
    component: ThreadList,
  });
  app.slots.experimental_threadAction(moveThreadAction);
  app.slots.experimental_threadAction(followUpThreadAction);
  app.slots.experimental_threadAction(completeThreadAction);
});
