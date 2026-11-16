import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import type { TimelineRow } from "@bb/server-contract";
import { promptInputToDraft, type PromptDraftState } from "@bb/client-core";
import type {
  ThreadTimelineEditMessageHandler,
  ThreadTimelineEditMessageTarget,
  ThreadTimelineInlineMessageEditor,
} from "@/components/thread/timeline";
import { appToast } from "@/components/ui/app-toast";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { useEditThreadMessage } from "@/hooks/mutations/thread-runtime-mutations";
import type { ThreadDetailSentMessageEdit } from "./ThreadDetailPromptArea";

interface SentMessageEditSession {
  draft: PromptDraftState;
  operationId: string;
  target: ThreadTimelineEditMessageTarget;
  threadId: string;
}

function hasTimelineRowId(
  rows: readonly TimelineRow[],
  rowId: string,
): boolean {
  return rows.some(
    (row) =>
      row.id === rowId ||
      (row.kind === "turn" &&
        row.children !== null &&
        hasTimelineRowId(row.children, rowId)),
  );
}

interface UseSentMessageEditingArgs {
  canStartEdit: boolean;
  threadId: string;
  timelineLoading: boolean;
  timelineRows: readonly TimelineRow[];
}

export function useSentMessageEditing({
  canStartEdit,
  threadId,
  timelineLoading,
  timelineRows,
}: UseSentMessageEditingArgs) {
  const editMessage = useEditThreadMessage();
  const submittingOperation = useRef<string | null>(null);
  const [sentMessageEditSession, setSentMessageEditSession] =
    useState<SentMessageEditSession | null>(null);
  const [sentMessageEditHostElement, setSentMessageEditHostElement] =
    useState<HTMLDivElement | null>(null);
  const activeSentMessageEditSession =
    sentMessageEditSession?.threadId === threadId
      ? sentMessageEditSession
      : null;
  const canEditSentMessages =
    canStartEdit && sentMessageEditSession === null && !editMessage.isPending;
  const handleEditSentMessage = useCallback<ThreadTimelineEditMessageHandler>(
    (target: ThreadTimelineEditMessageTarget) => {
      if (!canEditSentMessages || submittingOperation.current !== null) {
        return;
      }
      setSentMessageEditHostElement(null);
      setSentMessageEditSession({
        draft: promptInputToDraft(target.input),
        operationId: nanoid(),
        target,
        threadId,
      });
    },
    [canEditSentMessages, threadId],
  );
  const sentMessageEditThreadId = sentMessageEditSession?.threadId ?? null;
  const sentMessageEditTargetMessageId =
    sentMessageEditSession?.target.messageId ?? null;
  const sentMessageEditTargetStillPresent =
    sentMessageEditThreadId === threadId &&
    sentMessageEditTargetMessageId !== null
      ? hasTimelineRowId(timelineRows, sentMessageEditTargetMessageId)
      : true;
  const shouldDiscardMissingSentMessageEdit =
    sentMessageEditThreadId !== null &&
    sentMessageEditThreadId === threadId &&
    !timelineLoading &&
    !sentMessageEditTargetStillPresent;
  useEffect(() => {
    if (!shouldDiscardMissingSentMessageEdit) {
      return;
    }
    setSentMessageEditHostElement(null);
    setSentMessageEditSession(null);
    appToast.warning("The message being edited is no longer available.");
  }, [shouldDiscardMissingSentMessageEdit]);
  const activeSentMessageEditOperationId =
    activeSentMessageEditSession?.operationId ?? null;
  const updateSentMessageEditDraft = useCallback(
    (update: (current: PromptDraftState) => PromptDraftState) => {
      setSentMessageEditSession((current) =>
        current?.operationId === activeSentMessageEditOperationId
          ? { ...current, draft: update(current.draft) }
          : current,
      );
    },
    [activeSentMessageEditOperationId],
  );
  const closeSentMessageEdit = useCallback((operationId: string) => {
    setSentMessageEditSession((current) =>
      current?.operationId === operationId ? null : current,
    );
  }, []);
  const cancelSentMessageEdit = useCallback(() => {
    if (!activeSentMessageEditSession || submittingOperation.current !== null) {
      return;
    }
    closeSentMessageEdit(activeSentMessageEditSession.operationId);
  }, [activeSentMessageEditSession, closeSentMessageEdit]);
  const submitSentMessageEdit = useCallback<
    ThreadDetailSentMessageEdit["onSubmit"]
  >(
    (target) => {
      if (
        !activeSentMessageEditSession ||
        submittingOperation.current !== null
      ) {
        return;
      }
      const session = activeSentMessageEditSession;
      submittingOperation.current = session.operationId;
      const execution = target.execution;
      void editMessage
        .mutateAsync({
          id: session.threadId,
          operationId: session.operationId,
          expectedRequestSequence: session.target.expectedRequestSequence,
          input: target.input,
          ...(execution
            ? {
                model: execution.model,
                permissionMode: execution.permissionMode,
                reasoningLevel: execution.reasoningLevel,
                executionInputSources: execution.executionInputSources,
                ...(execution.supportsServiceTier && execution.serviceTier
                  ? { serviceTier: execution.serviceTier }
                  : {}),
              }
            : {}),
        })
        .then(() => {
          closeSentMessageEdit(session.operationId);
        })
        .catch((error) => {
          showMutationErrorToast({
            error,
            fallbackMessage: "Failed to edit the message",
            lifecycleOperation: "edit_message",
          });
        })
        .finally(() => {
          submittingOperation.current = null;
        });
    },
    [activeSentMessageEditSession, closeSentMessageEdit, editMessage],
  );
  const activeSentMessageEditTargetMessageId =
    activeSentMessageEditSession?.target.messageId ?? null;
  const inlineMessageEditor = useMemo<
    ThreadTimelineInlineMessageEditor | undefined
  >(
    () =>
      activeSentMessageEditTargetMessageId !== null
        ? {
            messageId: activeSentMessageEditTargetMessageId,
            onHostElementChange: setSentMessageEditHostElement,
          }
        : undefined,
    [activeSentMessageEditTargetMessageId],
  );
  const sentMessageEdit = useMemo<ThreadDetailSentMessageEdit | undefined>(
    () =>
      activeSentMessageEditSession
        ? {
            draft: activeSentMessageEditSession.draft,
            hostElement: sentMessageEditHostElement,
            isSubmitting: editMessage.isPending,
            operationId: activeSentMessageEditSession.operationId,
            onCancel: cancelSentMessageEdit,
            onSubmit: submitSentMessageEdit,
            updateDraft: updateSentMessageEditDraft,
          }
        : undefined,
    [
      activeSentMessageEditSession,
      cancelSentMessageEdit,
      editMessage.isPending,
      sentMessageEditHostElement,
      submitSentMessageEdit,
      updateSentMessageEditDraft,
    ],
  );
  return {
    handleEditSentMessage: canEditSentMessages
      ? handleEditSentMessage
      : undefined,
    inlineMessageEditor,
    sentMessageEdit,
  };
}
