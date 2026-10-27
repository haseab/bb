import type { useSdk } from "@get-bb/plugin-sdk/app";

export async function moveThreadToSection(
  sdk: ReturnType<typeof useSdk>,
  thread: {
    id: string;
    pinnedAt: number | null;
    sectionId: string | null;
    parentThreadId: string | null;
  },
  sectionId: string | null,
): Promise<void> {
  if (thread.pinnedAt !== null)
    await sdk.threads.unpin({ threadId: thread.id });
  if (thread.sectionId === sectionId && thread.parentThreadId === null) return;
  await sdk.threads.update({
    threadId: thread.id,
    sectionId,
    ...(thread.parentThreadId === null ? {} : { parentThreadId: null }),
  });
}
