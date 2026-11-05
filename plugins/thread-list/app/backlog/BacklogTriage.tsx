import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  useRpc,
  useBbNavigate,
  type PluginCommandRegistration,
  type PluginThreadActionRegistration,
} from "@get-bb/plugin-sdk/app";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { threadListRpcContract } from "../../server.js";
import {
  formatFollowUpDate,
  parseFollowUpDate,
} from "../../shared/follow-up-date.js";
import { backlogStateAtom } from "./state.js";
import { useSidebarData } from "../model/use-sidebar-data.js";
import { sidebarManualThreadOrderAtom } from "../preferences/atoms.js";

let openTriage: ((threadId?: string) => void) | null = null;
let canTriage = false;
export const backlogTriageCommand: PluginCommandRegistration = {
  id: "triage-backlog",
  title: "Triage Backlog follow-up dates",
  defaultShortcut: { key: "e", mod: true },
  isAvailable: () => openTriage !== null && canTriage,
  run: () => {
    openTriage?.();
  },
};
export const followUpThreadAction: PluginThreadActionRegistration = {
  id: "follow-up",
  title: "Follow up…",
  icon: "Clock",
  group: "organize",
  order: 60,
  item: ({ thread }) =>
    thread.archivedAt !== null
      ? null
      : {
          label: "Follow up…",
          icon: "Clock",
          disabled: openTriage === null,
          run: () => {
            openTriage?.(thread.id);
          },
        },
};

export function BacklogTriage() {
  const navigate = useBbNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const [peeking, setPeeking] = useState(false);
  const peekThread = useRef<string | null>(null);
  const rpc = useRpc<typeof threadListRpcContract>();
  const compact = useIsCompactViewport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useAtom(backlogStateAtom);
  const { projects, status } = useSidebarData();
  const manualOrder = useAtomValue(sidebarManualThreadOrderAtom);
  const threads = useMemo(
    () => projects.flatMap((project) => project.threads),
    [projects],
  );
  const untriaged = useMemo(() => {
    const eligible = new Set(
      state.items
        .filter((item) => item.stage === "backlog" && item.followUpAt === null)
        .map((item) => item.threadId),
    );
    const positions = new Map(manualOrder.map((id, index) => [id, index]));
    return threads
      .filter(
        (thread) =>
          eligible.has(thread.id) &&
          thread.sectionId === state.sectionId &&
          thread.archivedAt === null &&
          thread.pinnedAt === null &&
          thread.parentThreadId === null,
      )
      .sort(
        (a, b) =>
          (positions.get(a.id) ?? manualOrder.length) -
            (positions.get(b.id) ?? manualOrder.length) ||
          b.updatedAt - a.updatedAt,
      )
      .map((thread) => thread.id);
  }, [threads, state, manualOrder]);
  const [open, setOpen] = useState(false);
  const [onlyBacklog, setOnlyBacklog] = useState(true);
  const [ids, setIds] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [referenceAt, setReferenceAt] = useState(Date.now);
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sourceFocus = useRef<HTMLElement | null>(null);
  const start = useCallback(
    (threadId?: string) => {
      sourceFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      sourceFocus.current?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      setOnlyBacklog(threadId === undefined);
      setIds(threadId ? [threadId] : untriaged);
      setInput("");
      setReferenceAt(Date.now());
      setError(null);
      setOpen(true);
    },
    [untriaged],
  );
  useEffect(() => {
    openTriage = start;
    canTriage = untriaged.length > 0 && !open;
    return () => {
      if (openTriage === start) {
        openTriage = null;
        canTriage = false;
      }
    };
  }, [start, untriaged.length, open]);
  const current = threads.find((thread) => thread.id === ids[0]);
  const togglePeek = useCallback(() => {
    if (!current || saving) return;
    const next = !peeking;
    peekThread.current = next ? current.id : null;
    navigate.toThread(current.id, { experimental_userMessagesOnly: next });
    setPeeking(next);
  }, [current, saving, peeking, navigate]);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) togglePeek();
      } else if (peeking && event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        togglePeek();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [open, peeking, togglePeek]);
  useEffect(
    () => () => {
      if (peekThread.current)
        navigateRef.current.toThread(peekThread.current, {
          experimental_userMessagesOnly: false,
        });
    },
    [],
  );
  const record = state.items.find((item) => item.threadId === current?.id);
  const at = useMemo(
    () => parseFollowUpDate(input, referenceAt, timeZone),
    [input, referenceAt, timeZone],
  );
  const advance = () => {
    setIds((previous) => previous.slice(1));
    setInput("");
    setReferenceAt(Date.now());
    setError(null);
  };
  const save = async () => {
    if (!current || saving || at === null) return;
    setSaving(true);
    setError(null);
    try {
      const next = await rpc.call("scheduleFollowUp", {
        threadId: current.id,
        input,
        timeZone,
        onlyBacklog,
      });
      setState(next);
      advance();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save follow-up date.",
      );
    } finally {
      setSaving(false);
    }
  };
  const close = () => {
    if (!saving) setOpen(false);
  };
  return (
    <Dialog
      open={open && !peeking}
      modal={false}
      onOpenChange={(value) => {
        if (!saving) setOpen(value);
      }}
    >
      {status === "ready" && untriaged.length > 0 && (
        <div className="mx-2 mb-2 mt-1">
          <button
            type="button"
            data-backlog-triage-banner=""
            aria-label={`Triage ${untriaged.length} Backlog ${untriaged.length === 1 ? "thread" : "threads"}`}
            disabled={open}
            onClick={() => start()}
            className="flex w-full items-center gap-3 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2.5 text-left text-sidebar-foreground transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
          >
            <Icon name="Clock" className="size-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">
                Backlog to triage
              </span>
              <span className="block text-2xs text-muted-foreground">
                {untriaged.length}{" "}
                {untriaged.length === 1 ? "thread needs" : "threads need"} a
                follow-up date
              </span>
            </span>
            <Icon
              name="ChevronRight"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </button>
        </div>
      )}
      {open &&
        !compact &&
        createPortal(
          <div
            data-backlog-triage-backdrop=""
            className={`fixed inset-0 z-[100] bg-background/70 backdrop-blur-xs transition-opacity duration-200 motion-reduce:transition-none ${peeking ? "pointer-events-none opacity-0" : "opacity-100"}`}
            onPointerDown={close}
          />,
          document.body,
        )}
      {peeking &&
        createPortal(
          <button
            type="button"
            onClick={togglePeek}
            className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-full border bg-background px-4 py-2 text-xs text-muted-foreground shadow-sm"
          >
            Your messages · ⌘P / Esc to return
          </button>,
          document.body,
        )}
      <DialogContent
        hideCloseButton
        className="z-[100] max-w-lg gap-0 rounded-xl p-6"
        compactContentClassName="z-[100] p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onAfterCloseAutoFocus={() => {
          if (!peekThread.current && sourceFocus.current?.isConnected)
            sourceFocus.current.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Backlog follow-up triage</DialogTitle>
        <DialogDescription className="sr-only">
          Choose when this thread returns to Queued. Enter saves, Tab skips,
          Escape closes.
        </DialogDescription>
        <header className="mb-6 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Backlog <span className="mx-1 opacity-50">/</span> {ids.length}{" "}
            remaining
          </span>
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            disabled={saving}
            onClick={close}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="X" className="size-4" />
          </button>
        </header>
        {current ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="mb-6 min-h-20">
              <p className="mb-2 text-xs text-muted-foreground">
                {
                  projects.find((project) => project.id === current.projectId)
                    ?.name
                }
                {record
                  ? ` · ${record.followUpAt ? "Scheduled" : "Default"} ${new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric" }).format(new Date(record.refreshAt))}`
                  : ""}
              </p>
              <h2 className="text-xl font-medium leading-snug tracking-tight">
                {current.displayTitle}
              </h2>
            </div>
            <label htmlFor="backlog-follow-up" className="sr-only">
              Follow up
            </label>
            <Input
              ref={inputRef}
              key={current.id}
              id="backlog-follow-up"
              autoFocus
              autoComplete="off"
              value={input}
              disabled={saving}
              placeholder="Follow up in… 7d, 61 min, Sep 1"
              className="h-11"
              onKeyDown={(event) => {
                if (
                  event.key === "Tab" &&
                  !event.shiftKey &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  if (!saving) advance();
                }
              }}
              onChange={(event) => {
                setInput(event.target.value);
                setReferenceAt(Date.now());
                setError(null);
              }}
            />
            <p
              aria-live="polite"
              className="mt-2 min-h-5 text-xs text-muted-foreground"
            >
              {at !== null
                ? `Returns ${formatFollowUpDate(at, timeZone)}`
                : input.trim()
                  ? "Enter a future date or duration."
                  : "\u00a0"}
            </p>
            {error && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <footer className="mt-6 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                <kbd className="mr-1 font-sans">Esc</kbd> close
              </span>
              <div className="flex items-center gap-5">
                <button
                  type="button"
                  onClick={togglePeek}
                  disabled={saving}
                  className="transition-colors hover:text-foreground"
                >
                  <kbd className="mr-1 font-sans">⌘P</kbd> peek
                </button>
                <button
                  type="button"
                  aria-label="Skip"
                  disabled={saving}
                  onClick={advance}
                  className="transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <kbd className="mr-1 font-sans">Tab</kbd> skip
                </button>
                <button
                  type="submit"
                  aria-label="Save and next"
                  disabled={saving || at === null}
                  className="text-foreground transition-opacity disabled:opacity-40"
                >
                  <kbd className="mr-1 font-sans">↵</kbd>{" "}
                  {saving ? "Saving…" : "save & next"}
                </button>
              </div>
            </footer>
          </form>
        ) : (
          <div className="py-6 text-sm text-muted-foreground">
            No Backlog threads left to triage. Scheduled threads keep their
            follow-up dates.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
