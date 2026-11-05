import { useAtom } from "jotai";
import { sidebarThreadFocusRequestAtom } from "@/lib/sidebar-thread-focus";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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

function paintThreadCursor(
  root: HTMLElement | null,
  threadId: string | null,
): void {
  for (const link of root?.querySelectorAll<HTMLElement>(THREAD_LINK) ?? []) {
    if (threadId !== null && link.dataset.sidebarThreadId === threadId)
      link.setAttribute("data-sidebar-thread-cursor", "true");
    else link.removeAttribute("data-sidebar-thread-cursor");
  }
}

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
  const [focusRequest, setFocusRequest] = useAtom(
    sidebarThreadFocusRequestAtom,
  );
  const focusRequestRef = useRef(focusRequest);
  const lastActiveThreadId = useRef<string | null | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const previousOrder = useRef<string[]>([]);
  const sidebarOwnsKeyboard = useRef(false);
  const chatElement = useRef<HTMLElement | null>(null);
  const pendingFrame = useRef<number | null>(null);
  const generation = useRef(0);
  const { isCompactViewport, setOpen, setOpenMobile } = useSidebar();
  const commands = useAppCommandRunner();
  const entries = useSidebarThreadEntries();

  const selectThread = useCallback(
    (threadId: string) => {
      selectedRef.current = threadId;
      setSelectedId(threadId);
      previousOrder.current = getSidebarThreadNavigationTargets(
        rootRef.current,
      ).map((item) => item.threadId);
      paintThreadCursor(rootRef.current, threadId);
    },
    [rootRef],
  );

  const focusTarget = useCallback(
    (target: SidebarThreadShortcutTarget) => {
      const currentGeneration = ++generation.current;
      selectThread(target.threadId);
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
    [rootRef, selectThread],
  );

  useLayoutEffect(() => {
    if (!enabled) return;
    const routeChanged = lastActiveThreadId.current !== activeThreadId;
    lastActiveThreadId.current = activeThreadId;
    focusRequestRef.current = focusRequest;
    if (
      focusRequest &&
      routeChanged &&
      activeThreadId !== focusRequest.threadId
    ) {
      focusRequestRef.current = null;
      setFocusRequest(null);
    }
    const requested = focusRequestRef.current?.threadId;
    const id = requested ?? activeThreadId;
    if (id === null || (!requested && !routeChanged)) return;
    const root = rootRef.current;
    const target = getSidebarThreadNavigationTargets(root).find(
      (item) => item.threadId === id,
    );
    if (requested) sidebarOwnsKeyboard.current = true;
    if (
      target &&
      sidebarOwnsKeyboard.current &&
      (requested ||
        document.activeElement === document.body ||
        focusedThread(root))
    )
      focusTarget(target);
    else selectThread(id);
  }, [
    activeThreadId,
    enabled,
    focusRequest,
    setFocusRequest,
    rootRef,
    selectThread,
    focusTarget,
  ]);

  useAppCommandHandler(
    "sidebar.focus",
    () => {
      if (!enabled) return false;
      if (isCompactViewport) setOpenMobile(true);
      else setOpen(true);
      sidebarOwnsKeyboard.current = true;
      const focus = () => {
        const targets = getSidebarThreadNavigationTargets(rootRef.current);
        const target =
          targets.find((item) => item.threadId === selectedRef.current) ??
          targets.find((item) => item.threadId === activeThreadId) ??
          targets[0];
        if (!target) return false;
        focusTarget(target);
        return true;
      };
      if (!focus())
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
      sidebarOwnsKeyboard.current = false;
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
    const clearFocusRequest = () => {
      if (focusRequestRef.current === null) return;
      focusRequestRef.current = null;
      setFocusRequest(null);
    };
    const onUserKeyDown = (event: KeyboardEvent) => {
      if (!["Meta", "Control", "Alt", "Shift"].includes(event.key))
        clearFocusRequest();
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const link = target.closest<HTMLElement>(THREAD_LINK);
      if (link && root.contains(link)) {
        sidebarOwnsKeyboard.current = true;
        const id = link.dataset.sidebarThreadId ?? null;
        const requested = focusRequestRef.current?.threadId;
        if (requested && requested !== id) {
          const target = getSidebarThreadNavigationTargets(root).find(
            (item) => item.threadId === requested,
          );
          if (target) focusTarget(target);
          else selectThread(requested);
        } else if (id !== null) selectThread(id);
      } else if (target.closest("[data-app-content-shell]")) {
        sidebarOwnsKeyboard.current = false;
        chatElement.current = target;
      }
    };
    const onClick = (event: MouseEvent) => {
      clearFocusRequest();
      if (!(event.target instanceof Element) || event.button !== 0) return;
      const link =
        event.target.closest<HTMLElement>(THREAD_LINK) ??
        event.target
          .closest("[data-sidebar-rename-row]")
          ?.querySelector<HTMLElement>(THREAD_LINK);
      const id = link?.dataset.sidebarThreadId;
      if (id) {
        sidebarOwnsKeyboard.current = true;
        selectThread(id);
        if (event.target.closest(THREAD_LINK))
          link?.focus({ preventScroll: true });
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      clearFocusRequest();
      if (!(event.target instanceof Element) || root.contains(event.target))
        return;
      if (
        !event.target.closest(
          'input, textarea, button, a, select, [contenteditable="true"], [role="textbox"], [tabindex]',
        )
      )
        return;
      sidebarOwnsKeyboard.current = false;
      generation.current += 1;
      if (pendingFrame.current !== null)
        cancelAnimationFrame(pendingFrame.current);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") sidebarOwnsKeyboard.current = false;
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
      if (!id) return;
      const targets = getSidebarThreadNavigationTargets(root);
      const target = targets.find((item) => item.threadId === id);
      if (target) {
        paintThreadCursor(root, id);
        if (
          focusRequestRef.current?.threadId === id &&
          target.element !== document.activeElement
        )
          focusTarget(target);
        return;
      }
      if (focusRequestRef.current?.threadId === id) return;
      if (!previousOrder.current.includes(id)) return;
      const index = Math.max(0, previousOrder.current.indexOf(id));
      const next = targets[Math.min(index, targets.length - 1)];
      if (!next) return;
      const shouldFocus =
        sidebarOwnsKeyboard.current &&
        (document.activeElement === document.body ||
          root.contains(document.activeElement));
      selectThread(next.threadId);
      if (shouldFocus) focusTarget(next);
    });
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onUserKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("click", onClick, true);
    paintThreadCursor(root, selectedRef.current);
    previousOrder.current = getSidebarThreadNavigationTargets(root).map(
      (item) => item.threadId,
    );
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onUserKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("click", onClick, true);
      paintThreadCursor(root, null);
      observer.disconnect();
      generation.current += 1;
      if (pendingFrame.current !== null)
        cancelAnimationFrame(pendingFrame.current);
    };
  }, [enabled, rootRef, focusTarget, selectThread, setFocusRequest]);

  const entry = selectedId === null ? undefined : entries.get(selectedId);
  return entry ? (
    <ArchiveSelectedThread
      thread={threadListEntryActionTarget(entry)}
      rootRef={rootRef}
    />
  ) : null;
}
