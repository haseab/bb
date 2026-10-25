import type { PluginCommandRegistration } from "@get-bb/plugin-sdk/app";

export type ThreadPipelineAction =
  | "section-up"
  | "section-down"
  | "order-up"
  | "order-down";

type PipelineHandler = {
  canRun(threadId: string): boolean;
  run(threadId: string, action: ThreadPipelineAction): Promise<void>;
};

let handler: PipelineHandler | null = null;

export function bindThreadPipelineHandler(next: PipelineHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

function targetThreadId(threadId: string | null): string | null {
  const focused = document.activeElement
    ?.closest("[data-sidebar-rename-row]")
    ?.querySelector("[data-sidebar-thread-id]");
  return focused?.getAttribute("data-sidebar-thread-id") ?? threadId;
}

const definitions = [
  {
    id: "section-up",
    title: "Move thread to previous section",
    defaultShortcut: { key: "ArrowUp", mod: true },
  },
  {
    id: "section-down",
    title: "Move thread to next section",
    defaultShortcut: { key: "ArrowDown", mod: true },
  },
  {
    id: "order-up",
    title: "Move thread up in section",
    defaultShortcut: { key: "ArrowUp", alt: true },
  },
  {
    id: "order-down",
    title: "Move thread down in section",
    defaultShortcut: { key: "ArrowDown", alt: true },
  },
] as const;

export const threadPipelineCommands: PluginCommandRegistration[] =
  definitions.map((definition) => ({
    ...definition,
    isAvailable: ({ threadId }) => {
      const target = targetThreadId(threadId);
      return target !== null && (handler?.canRun(target) ?? false);
    },
    run: async ({ threadId }) => {
      const target = targetThreadId(threadId);
      if (target !== null) await handler?.run(target, definition.id);
    },
  }));
