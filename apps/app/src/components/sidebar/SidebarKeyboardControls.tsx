import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  useAppCommandHandler,
  useAppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { useSidebar } from "@/components/ui/sidebar";
import { isEditableKeyboardTarget } from "@/lib/app-keybindings";
import { useSidebarThreadEntries } from "@/lib/sidebar-thread-entries";
import { threadListEntryActionTarget } from "@/lib/thread-actions/thread-action-target";
import { useThreadActionEntries } from "@/lib/thread-actions/thread-action-registry";
import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk";
import {
  getSidebarThreadNavigationTargets,
  type SidebarThreadShortcutTarget,
} from "./sidebarThreadShortcuts";

const THREAD_LINK = "a[data-sidebar-thread-id]";
const ARCHIVE_KEYS = ["bb--core/archive"];

function focusedThread(root: HTMLElement | null): HTMLElement | null {
  const link =
    document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>(THREAD_LINK)
      : null;
  return link && root?.contains(link) ? link : null;
}

function ArchiveSelectedThread({
  thread,
  rootRef,
}: {
  thread: PluginThreadActionTarget;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const [archive] = useThreadActionEntries(thread, { keys: ARCHIVE_KEYS });
  const available = () =>
    focusedThread(rootRef.current)?.dataset.sidebarThreadId === thread.id &&
    thread.archivedAt === null &&
    archive !== undefined &&
    !archive.action.disabled;
  useAppCommandHandler(
    "sidebar.archiveSelected",
    () => {
      if (!available() || !archive) return false;
      void archive.action.run();
      return true;
    },
    10,
    true,
    available,
  );
  return null;
}

export function SidebarKeyboardControls({
  rootRef,
  activeThreadId,
  enabled,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  activeThreadId: string | null;
  enabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const previousOrder = useRef<string[]>([]);
  const sidebarOwnsFocus = useRef(false);
  const chatElement = useRef<HTMLElement | null>(null);
  const pendingFrame = useRef<number | null>(null);
  const generation = useRef(0);
  const { isCompactViewport, setOpen, setOpenMobile } = useSidebar();
  const commands = useAppCommandRunner();
  const entries = useSidebarThreadEntries();

  const focusTarget = useCallback(
    (target: SidebarThreadShortcutTarget) => {
      const currentGeneration = ++generation.current;
      const root = rootRef.current;
      selectedRef.current = target.threadId;
      setSelectedId(target.threadId);
      previousOrder.current = getSidebarThreadNavigationTargets(root).map(
        (item) => item.threadId,
      );
      target.placeholder?.scrollIntoView({ block: "nearest" });
      const attempt = (remaining: number) => {
        if (generation.current !== currentGeneration) return;
        const link = getSidebarThreadNavigationTargets(rootRef.current).find(
          (item) => item.threadId === target.threadId,
        )?.element;
        if (link) {
          link.focus({ preventScroll: true });
          link.scrollIntoView({ block: "nearest" });
        } else if (remaining > 0) {
          pendingFrame.current = requestAnimationFrame(() =>
            attempt(remaining - 1),
          );
        }
      };
      attempt(12);
    },
    [rootRef],
  );

  useAppCommandHandler(
    "sidebar.focus",
    () => {
      if (!enabled) return false;
      if (isCompactViewport) setOpenMobile(true);
      else setOpen(true);
      sidebarOwnsFocus.current = true;
      const focus = () => {
        const targets = getSidebarThreadNavigationTargets(rootRef.current);
        const target =
          targets.find((item) => item.threadId === selectedRef.current) ??
          targets.find((item) => item.threadId === activeThreadId) ??
          targets[0];
        if (target) focusTarget(target);
      };
      pendingFrame.current = requestAnimationFrame(() => {
        pendingFrame.current = requestAnimationFrame(focus);
      });
      return true;
    },
    0,
    enabled,
  );

  useAppCommandHandler(
    "chat.focus",
    () => {
      if (!enabled) return false;
      generation.current += 1;
      sidebarOwnsFocus.current = false;
      if (
        chatElement.current?.isConnected &&
        chatElement.current.checkVisibility({ visibilityProperty: true })
      ) {
        chatElement.current.focus();
        return true;
      }
      return commands.dispatch("composer.focus", null);
    },
    0,
    enabled,
  );

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const link = target.closest<HTMLElement>(THREAD_LINK);
      if (link && root.contains(link)) {
        sidebarOwnsFocus.current = true;
        const id = link.dataset.sidebarThreadId ?? null;
        selectedRef.current = id;
        setSelectedId(id);
        previousOrder.current = getSidebarThreadNavigationTargets(root).map(
          (item) => item.threadId,
        );
      } else if (target.closest("[data-app-content-shell]")) {
        sidebarOwnsFocus.current = false;
        chatElement.current = target;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isEditableKeyboardTarget(event.target)
      )
        return;
      const link = focusedThread(root);
      if (!link || (event.key !== "ArrowUp" && event.key !== "ArrowDown"))
        return;
      const targets = getSidebarThreadNavigationTargets(root);
      const index = targets.findIndex(
        (item) =>
          item.threadId ===
          (selectedRef.current ?? link.dataset.sidebarThreadId),
      );
      if (index === -1) return;
      event.preventDefault();
      event.stopPropagation();
      const next = targets[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (next) focusTarget(next);
    };
    const observer = new MutationObserver(() => {
      const id = selectedRef.current;
      if (!id || !sidebarOwnsFocus.current) return;
      const targets = getSidebarThreadNavigationTargets(root);
      if (targets.some((item) => item.threadId === id)) return;
      const index = Math.max(0, previousOrder.current.indexOf(id));
      const next = targets[Math.min(index, targets.length - 1)];
      if (
        next &&
        (document.activeElement === document.body ||
          root.contains(document.activeElement))
      )
        focusTarget(next);
    });
    document.addEventListener("focusin", onFocus);
    root.addEventListener("keydown", onKeyDown);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onFocus);
      root.removeEventListener("keydown", onKeyDown);
      observer.disconnect();
      generation.current += 1;
      if (pendingFrame.current !== null)
        cancelAnimationFrame(pendingFrame.current);
    };
  }, [enabled, rootRef, focusTarget]);

  const entry = selectedId === null ? undefined : entries.get(selectedId);
  return entry ? (
    <ArchiveSelectedThread
      thread={threadListEntryActionTarget(entry)}
      rootRef={rootRef}
    />
  ) : null;
}
