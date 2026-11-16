// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createDeferredPromise } from "@bb/test-helpers";
import type { PromptInput } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSentMessageEditing } from "./useSentMessageEditing";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useEditThreadMessage: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
  }),
}));
vi.mock("@/lib/mutation-errors", () => ({
  showMutationErrorToast: mocks.showError,
}));

const input: PromptInput[] = [
  { type: "text", text: "Replacement", mentions: [] },
];
const submission = {
  input,
  execution: {
    model: "gpt-6.1-sol",
    permissionMode: "auto" as const,
    reasoningLevel: "medium",
    serviceTier: undefined,
    supportsServiceTier: false,
    executionInputSources: {},
  },
};
const target = { messageId: "message-1", expectedRequestSequence: 7, input };

function openEditor() {
  const hook = renderHook(() =>
    useSentMessageEditing({
      canStartEdit: true,
      threadId: "thread-1",
      timelineLoading: true,
      timelineRows: [],
    }),
  );
  act(() => hook.result.current.handleEditSentMessage?.(target));
  return hook;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("sent message submission", () => {
  it("keeps the editor and submits once when Escape and submit follow submission before React renders", async () => {
    const request = createDeferredPromise<void>();
    mocks.mutateAsync.mockReturnValue(request.promise);
    const { result } = openEditor();
    const editor = result.current.sentMessageEdit!;

    act(() => {
      editor.onSubmit(submission);
      editor.onCancel();
      editor.onSubmit(submission);
    });

    expect(result.current.sentMessageEdit?.operationId).toBe(
      editor.operationId,
    );
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
    await act(async () => request.resolve());
    await waitFor(() => expect(result.current.sentMessageEdit).toBeUndefined());
    expect(result.current.handleEditSentMessage).toBeDefined();
  });

  it("retains the draft and allows a retry after a failed submission", async () => {
    const request = createDeferredPromise<void>();
    mocks.mutateAsync
      .mockReturnValueOnce(request.promise)
      .mockResolvedValue(undefined);
    const { result } = openEditor();
    const operationId = result.current.sentMessageEdit!.operationId;
    act(() => result.current.sentMessageEdit!.onSubmit(submission));
    await act(async () => request.reject(new Error("Preparation timed out")));
    await waitFor(() => expect(mocks.showError).toHaveBeenCalledOnce());
    expect(result.current.sentMessageEdit?.draft.text).toBe("Replacement");

    await act(async () => result.current.sentMessageEdit!.onSubmit(submission));
    await waitFor(() => expect(result.current.sentMessageEdit).toBeUndefined());
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
    expect(
      mocks.mutateAsync.mock.calls.map(([request]) => request.operationId),
    ).toEqual([operationId, operationId]);
  });

  it("still cancels an edit before submission", () => {
    const { result } = openEditor();
    act(() => result.current.sentMessageEdit!.onCancel());
    expect(result.current.sentMessageEdit).toBeUndefined();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
