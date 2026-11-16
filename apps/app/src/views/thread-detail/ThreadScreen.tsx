import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { defaultAppSettings, type Environment } from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import {
  appendQuoteAndAttachmentsToDraft,
  type PromptDraftAttachment,
  type PromptMentionLinkResolver,
} from "@bb/client-core";
import { cn } from "@bb/shared-ui/lib/utils";
import { OverflowFade } from "@bb/shared-ui/overflow-fade";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  isRunningThreadRuntimeDisplayStatus,
  ThreadTimelineSurface,
  type ThreadTimelineAddToChatHandler,
  type ThreadTimelineConsumerMessageAction,
  type ThreadTimelineForkMessageHandler,
  type ThreadTimelineUnreadDividerPlacement,
  type TimelineTitleActionResolver,
  type UseThreadTimelineControllerResult,
} from "@/components/thread/timeline";
import type { HostConnectionNotice } from "@/components/thread/timeline/ThreadTimelineSurface";
import { ThreadTimelinePanelLoadingSkeleton } from "@/components/thread/timeline/ThreadChatLoading";
import { ThreadTableOfContents } from "@/components/thread/toc/ThreadTableOfContents";
import {
  ThreadContextCard,
  useThreadContextCardContentInset,
  WithoutThreadContextCard,
} from "@/components/plugin/PluginThreadContextCard";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { PageShell } from "@/components/ui/page-shell.js";
import { SelectionAddToChatContext } from "@/components/thread/SelectionAddToChatContext";
import {
  isThreadDisplayStatusBannerActive,
  type ThreadPromptChildThreadsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import type { EnvironmentSummaryChrome } from "@/lib/environment-workspace-display";
import type { MachineRemovalStatus } from "@/lib/machine-removal-display";
import type { WorkspaceCheckoutDisplay } from "@bb/shared-ui/lib/workspace-checkout-display";
import { createCoreComposerActions } from "@/lib/plugin-composer-handle";
import {
  requestComposerFocus,
  subscribeComposerFocusRequests,
} from "@/lib/composer-focus-requests";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { useSentMessageEditing } from "./useSentMessageEditing";
import { useParentThreadSection } from "./useParentThreadSection";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  useChildThreads,
  useThreadPendingInteractions,
} from "@/hooks/queries/thread-queries";
import {
  useChildThreadPendingAttention,
  type ChildThreadPendingAttentionSource,
} from "@/hooks/queries/child-thread-pending-interactions";
import { useSendThreadMessage } from "@/hooks/mutations/thread-runtime-mutations";
import {
  ThreadDetailPromptArea,
  type ThreadComposerPermissionPolicy,
} from "./ThreadDetailPromptArea";

const THREAD_DETAIL_COMPOSER_ID = "thread-detail-follow-up-composer";
const EMPTY_CHILD_THREAD_ITEMS: readonly ChildThreadPendingAttentionSource[] =
  [];

export type ThreadScreenPresentation =
  | { kind: "page" }
  | {
      kind: "panel";
      layout: "contained" | "document";
      measure: "page" | "panel";
      tone: "background" | "sidebar";
    }
  | { kind: "transcript"; layout: "contained" | "document" };

export interface ThreadScreenTimelineHost {
  consumerMessageActions?: readonly ThreadTimelineConsumerMessageAction[];
  environmentHostName: string | null;
  includePluginMessageActions: boolean;
  leadingContent?: ReactNode;
  onForkMessage?: ThreadTimelineForkMessageHandler;
  onTitleAction?: TimelineTitleActionResolver;
  unreadDividerAutoScroll: boolean;
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null;
}

export interface ThreadScreenComposerHost {
  environmentCheckout: WorkspaceCheckoutDisplay | undefined;
  environmentChrome: EnvironmentSummaryChrome | undefined;
  contextEnvironmentId: string | null;
  focusRequest?: number;
  onCreateNewThreadInEnvironment?: () => void;
  onOpenThreadInfo?: () => void;
  permissionPolicy: ThreadComposerPermissionPolicy;
}

interface ThreadScreenProps {
  composer: ThreadScreenComposerHost | null;
  environment: Environment | null;
  presentation: ThreadScreenPresentation;
  projectId: string;
  resolveMentionLink: PromptMentionLinkResolver;
  thread: ThreadResponse;
  timeline: UseThreadTimelineControllerResult;
  timelineHost: ThreadScreenTimelineHost;
}

function buildHostConnectionNotice(
  thread: ThreadResponse,
  hostName: string | null,
): HostConnectionNotice | null {
  if (thread.runtime.displayStatus !== "waiting-for-host") {
    return null;
  }
  return { label: `${hostName ?? "Host"} disconnected` };
}

function resolveEnvironmentGoneStatus(
  environment: Environment | null,
): MachineRemovalStatus | "destroyed" | null {
  if (environment === null) return null;
  if (environment.hostLifecycle !== "active") return environment.hostLifecycle;
  return environment.status === "destroyed" ? "destroyed" : null;
}

export function useThreadComposerAddToChat(thread: {
  id: string;
  projectId: string;
}): ThreadTimelineAddToChatHandler {
  const isCompactViewport = useIsCompactViewport();
  const promptDraft = useMemo(
    () =>
      getPromptDraftAccessor({
        kind: "thread",
        projectId: thread.projectId,
        threadId: thread.id,
      }),
    [thread.id, thread.projectId],
  );
  return useCallback(
    (text: string, attachments?: readonly PromptDraftAttachment[]) => {
      if (isCompactViewport && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const composerActions = createCoreComposerActions({
        ...promptDraft,
        focus: () => requestComposerFocus(promptDraft.storageKey),
      });
      composerActions.replace((current) =>
        appendQuoteAndAttachmentsToDraft(current, text, attachments ?? []),
      );
      composerActions.focus();
    },
    [isCompactViewport, promptDraft],
  );
}

function useChildThreadsSection(
  threadId: string,
  enabled: boolean,
): ThreadPromptChildThreadsSection | null {
  const childThreadSubsetQuery = useChildThreads({
    enabled,
    parentThreadId: threadId,
  });
  const childThreadsSection = useMemo(() => {
    const list = enabled ? (childThreadSubsetQuery.data ?? []) : [];
    const activeItems = list
      .filter(
        (entry) =>
          entry.originKind === null &&
          (isThreadDisplayStatusBannerActive(entry.runtime.displayStatus) ||
            entry.hasPendingInteraction),
      )
      .sort((left, right) =>
        left.hasPendingInteraction === right.hasPendingInteraction
          ? right.latestAttentionAt - left.latestAttentionAt
          : left.hasPendingInteraction
            ? -1
            : 1,
      )
      .map((entry) => ({
        id: entry.id,
        title: getThreadDisplayTitle(entry),
        href: getThreadRoutePath({
          projectId: entry.projectId,
          threadId: entry.id,
        }),
        hasPendingInteraction: entry.hasPendingInteraction,
      }));
    if (activeItems.length === 0) return null;
    return { items: activeItems };
  }, [childThreadSubsetQuery.data, enabled]);
  const childPendingInteractions = useChildThreadPendingAttention(
    childThreadsSection?.items ?? EMPTY_CHILD_THREAD_ITEMS,
  );
  return useMemo((): ThreadPromptChildThreadsSection | null => {
    if (!childThreadsSection) return null;
    const pendingInteractions = childPendingInteractions
      .flatMap((child) =>
        child.interactions.map((interaction) => ({
          childThreadId: child.childThreadId,
          childTitle: child.childTitle,
          href: child.href,
          interaction,
        })),
      )
      .sort(
        (left, right) =>
          right.interaction.createdAt - left.interaction.createdAt,
      );
    return { ...childThreadsSection, pendingInteractions };
  }, [childThreadsSection, childPendingInteractions]);
}

function useComposerFocusRequestKey(
  storageKey: string,
  focusRequest: number | undefined,
): string | number {
  const [nonce, setNonce] = useState(0);
  useEffect(
    () =>
      subscribeComposerFocusRequests(storageKey, () =>
        setNonce((current) => current + 1),
      ),
    [storageKey],
  );
  return focusRequest === undefined ? nonce : `${nonce}:${focusRequest}`;
}

export function ThreadScreen({
  composer,
  environment,
  presentation,
  projectId,
  resolveMentionLink,
  thread,
  timeline,
  timelineHost,
}: ThreadScreenProps) {
  const systemConfigQuery = useSystemConfig();
  const contextCardInset = useThreadContextCardContentInset();
  const pendingInteractionsQuery = useThreadPendingInteractions(thread.id);
  const pendingInteractions = pendingInteractionsQuery.data ?? [];
  const hasPendingInteraction = pendingInteractions.length > 0;
  const sendMessage = useSendThreadMessage();
  const parentThreadSection = useParentThreadSection(thread, composer !== null);
  const childThreadsSection = useChildThreadsSection(
    thread.id,
    composer !== null,
  );
  const instanceId = useId();
  const handleAddToChat = useThreadComposerAddToChat(thread);
  const draftStorageKey = useMemo(
    () =>
      getPromptDraftAccessor({
        kind: "thread",
        projectId: thread.projectId,
        threadId: thread.id,
      }).storageKey,
    [thread.id, thread.projectId],
  );
  const composerFocusRequestKey = useComposerFocusRequestKey(
    draftStorageKey,
    composer?.focusRequest,
  );
  const [timelineNavigationTargetRowId, setTimelineNavigationTargetRowId] =
    useState<string | null>(null);
  const { timelineLoading, timelineRows } = timeline;
  const isThreadTimelinePending = timelineLoading && timelineRows.length === 0;

  const { handleEditSentMessage, inlineMessageEditor, sentMessageEdit } =
    useSentMessageEditing({
      canStartEdit:
        composer !== null &&
        thread.canEditMessages &&
        !hasPendingInteraction &&
        !sendMessage.isPending &&
        !isThreadTimelinePending,
      threadId: thread.id,
      timelineLoading,
      timelineRows,
    });

  const isPanelPresentation = presentation.kind !== "page";
  const selectionAddToChat = composer ? handleAddToChat : undefined;
  const surface = (
    <SelectionAddToChatContext.Provider value={selectionAddToChat}>
      <ThreadTimelineSurface
        activeThinking={timeline.activeThinking}
        canSpawnChild={thread.canSpawnChild}
        contextBoundarySeq={timeline.contextBoundarySeq}
        hasOlderTimelineRows={timeline.hasOlderTimelineRows}
        hostConnectionNotice={buildHostConnectionNotice(
          thread,
          timelineHost.environmentHostName,
        )}
        isCatchingUpTimeline={timeline.isCatchingUpTimeline}
        isLoadingOlderTimelineRows={timeline.isLoadingOlderTimelineRows}
        isThreadTimelinePending={isThreadTimelinePending}
        timelineError={Boolean(timeline.timelineError)}
        loadingContent={
          isPanelPresentation ? (
            <ThreadTimelinePanelLoadingSkeleton />
          ) : undefined
        }
        timelineErrorClassName={
          isPanelPresentation ? "mx-2 mt-4 text-destructive" : undefined
        }
        leadingContent={timelineHost.leadingContent}
        consumerMessageActions={timelineHost.consumerMessageActions}
        includePluginMessageActions={timelineHost.includePluginMessageActions}
        onForkMessage={timelineHost.onForkMessage}
        onEditMessage={handleEditSentMessage}
        inlineMessageEditor={inlineMessageEditor}
        onMessageAddToChat={selectionAddToChat}
        onSelectionAddToChat={selectionAddToChat}
        onLoadOlderRows={timeline.loadOlderTimelineRows}
        onTitleAction={timelineHost.onTitleAction}
        projectId={projectId}
        resolveMentionLink={resolveMentionLink}
        showOngoingIndicator={
          thread.status !== "stopping" &&
          !hasPendingInteraction &&
          isRunningThreadRuntimeDisplayStatus(thread.runtime.displayStatus) &&
          !isThreadTimelinePending
        }
        timelineRows={timelineRows}
        timelineNavigationTargetRowId={timelineNavigationTargetRowId}
        isStopping={thread.status === "stopping"}
        stoppingAnchorAt={thread.updatedAt}
        threadId={thread.id}
        threadRuntimeDisplayStatus={thread.runtime.displayStatus}
        unreadDividerAutoScroll={timelineHost.unreadDividerAutoScroll}
        unreadDividerPlacement={timelineHost.unreadDividerPlacement}
      />
    </SelectionAddToChatContext.Provider>
  );

  const chrome = composer?.environmentChrome;
  const promptArea = composer ? (
    <ThreadDetailPromptArea
      composerId={
        presentation.kind === "page"
          ? THREAD_DETAIL_COMPOSER_ID
          : `${THREAD_DETAIL_COMPOSER_ID}-${instanceId}`
      }
      isPrimaryComposer={presentation.kind === "page"}
      permissionPolicy={composer.permissionPolicy}
      contextWindowUsage={timeline.contextWindowUsage}
      environmentCheckout={composer.environmentCheckout}
      environmentCompactLabel={chrome?.environmentCompactLabel}
      environmentHost={chrome?.environmentHost}
      environmentIcon={chrome?.environmentIcon}
      environmentLabel={chrome?.environmentLabel}
      environmentMachineProvider={chrome?.environmentMachineProvider}
      environmentProviderName={chrome?.environmentProviderName}
      canRestoreEnvironment={thread.canRestoreEnvironment}
      environmentGoneStatus={resolveEnvironmentGoneStatus(environment)}
      environmentHostId={environment?.hostId}
      onCreateNewThreadInEnvironment={composer.onCreateNewThreadInEnvironment}
      onOpenThreadInfo={composer.onOpenThreadInfo}
      projectId={projectId}
      resolveMentionLink={resolveMentionLink}
      composerFocusRequestKey={composerFocusRequestKey}
      sendMessage={sendMessage}
      sentMessageEdit={sentMessageEdit}
      steerActiveThreadOnEnter={
        systemConfigQuery.data?.generalSettings.steerActiveThreadOnEnter ??
        defaultAppSettings.steerActiveThreadOnEnter
      }
      pendingInteractions={pendingInteractions}
      queuedMessageCount={thread.queuedMessageCount}
      pendingTodos={timeline.pendingTodos}
      activePromptMode={timeline.activePromptMode}
      goal={timeline.goal}
      providerCommands={timeline.providerCommands}
      sessionOptions={timeline.sessionOptions}
      modelFallback={timeline.modelFallback}
      activeWorkflows={timeline.activeWorkflows}
      activeBackgroundCommands={timeline.activeBackgroundCommands}
      parentThreadSection={parentThreadSection}
      childThreadsSection={childThreadsSection}
      contextEnvironmentId={composer.contextEnvironmentId}
      thread={thread}
    />
  ) : null;

  switch (presentation.kind) {
    case "page":
      return (
        <div
          data-thread-window=""
          className="flex h-full min-h-0 min-w-0 flex-col overflow-clip"
        >
          <PageShell
            key={thread.id}
            scrollBehavior="bottom-anchor"
            scrollAnchorThreadId={thread.id}
            scrollContentInsetEndPx={contextCardInset}
            shellClassName="!mx-0 !mt-0 md:!mx-0 md:!mt-0"
            scrollAreaClassName="scroll-pt-4"
            contentClassName="gap-2 pt-4"
            footerClassName="chat-prompt-box"
            footer={promptArea}
            scrollOverlay={
              <>
                <ThreadContextCard />
                <div className="pointer-events-auto my-auto">
                  <ThreadTableOfContents
                    contextBoundarySeq={timeline.contextBoundarySeq}
                    threadId={thread.id}
                    timelineRows={timelineRows}
                    hasOlderTimelineRows={timeline.hasOlderTimelineRows}
                    loadOlderTimelineRows={timeline.loadOlderTimelineRows}
                    onNavigateToRow={setTimelineNavigationTargetRowId}
                  />
                </div>
              </>
            }
          >
            {surface}
          </PageShell>
        </div>
      );
    case "panel":
      return (
        <WithoutThreadContextCard>
          <ThreadScreenPanelShell
            presentation={presentation}
            promptArea={promptArea}
            surface={surface}
            threadId={thread.id}
          />
        </WithoutThreadContextCard>
      );
    case "transcript":
      return (
        <WithoutThreadContextCard>
          {presentation.layout === "contained" ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-background px-2 pb-3 pt-3">
              {surface}
            </div>
          ) : (
            <div className="bg-background px-2 pb-3 pt-3">{surface}</div>
          )}
        </WithoutThreadContextCard>
      );
  }
}

function ThreadScreenPanelShell({
  presentation,
  promptArea,
  surface,
  threadId,
}: {
  presentation: Extract<ThreadScreenPresentation, { kind: "panel" }>;
  promptArea: ReactNode;
  surface: ReactNode;
  threadId: string;
}) {
  const { layout, measure, tone } = presentation;
  const surfaceClassName = tone === "sidebar" ? "bg-sidebar" : "bg-background";
  const maxWidthClassName = measure === "page" ? "max-w-[760px]" : "max-w-none";
  const footer = (
    <div className={cn("relative", surfaceClassName)}>
      <OverflowFade placement="above" tone={tone} />
      <div className="px-4 pb-4 pt-2">{promptArea}</div>
    </div>
  );
  if (layout === "document") {
    return (
      <div
        key={threadId}
        data-thread-window=""
        data-surface-tone={tone}
        className={cn("flex min-w-0 flex-col", surfaceClassName)}
      >
        <div
          className={cn(
            "mx-auto flex w-full min-w-0 flex-col",
            measure === "page" ? "px-4 pb-3 pt-3" : "px-2 pb-3 pt-3",
            maxWidthClassName,
          )}
        >
          {surface}
        </div>
        <div className="sticky bottom-0 z-20">{footer}</div>
      </div>
    );
  }
  return (
    <div
      data-thread-window=""
      data-surface-tone={tone}
      className="flex min-h-0 flex-1 flex-col"
    >
      <BottomAnchoredScrollBody
        key={threadId}
        scrollAreaClassName={cn(surfaceClassName, "scroll-pt-4")}
        contentClassName={
          measure === "page" ? "!pb-3 !pt-4" : "!px-2 !pb-3 !pt-4"
        }
        maxWidthClassName={maxWidthClassName}
        footer={footer}
        scrollAnchorThreadId={threadId}
      >
        {surface}
      </BottomAnchoredScrollBody>
    </div>
  );
}
