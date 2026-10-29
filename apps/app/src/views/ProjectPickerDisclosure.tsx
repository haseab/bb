import {
  projectBadgeLabel,
  projectBadgeStyle,
} from "@bb/shared-ui/project-identity";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

interface ProjectPickerDisclosureProps {
  label: string;
  autoFocus: boolean;
  loading: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  children: ReactNode;
}

export function ProjectPickerDisclosure({
  label,
  autoFocus,
  loading,
  inputRef,
  query,
  onQueryChange,
  children,
}: ProjectPickerDisclosureProps) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    openingTimerRef.current = setTimeout(() => setExpanded(true), 500);
    return () => {
      if (openingTimerRef.current !== null)
        clearTimeout(openingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (autoFocus && !ready) triggerRef.current?.focus({ preventScroll: true });
  }, [autoFocus, ready]);

  useEffect(() => {
    if (!expanded) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = setTimeout(() => setReady(true), reducedMotion ? 0 : 300);
    return () => clearTimeout(timer);
  }, [expanded]);

  useEffect(() => {
    if (!ready || !autoFocus) return;
    const frame = window.requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [ready, autoFocus, loading, inputRef]);

  const expand = () => {
    if (openingTimerRef.current !== null) clearTimeout(openingTimerRef.current);
    setExpanded(true);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-popover shadow-sm transition-colors duration-300 focus-within:border-file-accent/50">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Choose project"
        aria-controls={panelId}
        aria-expanded={expanded}
        onClick={() => {
          if (!expanded) {
            expand();
          } else {
            setExpanded(false);
            setReady(false);
            triggerRef.current?.focus({ preventScroll: true });
          }
        }}
        onKeyDown={(event) => {
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.nativeEvent.isComposing
          )
            return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            expand();
          } else if (event.key === "Backspace" && query.length > 0) {
            event.preventDefault();
            onQueryChange(query.slice(0, -1));
          } else if (
            event.key.length === 1 &&
            (event.key !== " " || query.length > 0)
          ) {
            event.preventDefault();
            onQueryChange(query + event.key);
            expand();
          }
        }}
        className="flex w-full items-center gap-3 px-4 py-4 text-left outline-none transition-colors hover:bg-state-hover focus-visible:bg-state-hover"
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border"
          style={projectBadgeStyle(projectBadgeLabel(label))}
        >
          <Icon name="Folder" className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">Project</span>
          <span className="block truncate text-sm font-medium text-foreground">
            {label}
          </span>
        </span>
        <Icon
          name="ChevronDown"
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
        />
      </button>
      <div
        id={panelId}
        aria-hidden={!ready}
        inert={!ready}
        data-project-picker-panel=""
        data-expanded={expanded}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
          expanded
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-border">{children}</div>
        </div>
      </div>
    </div>
  );
}
