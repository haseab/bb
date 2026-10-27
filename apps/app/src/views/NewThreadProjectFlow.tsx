import {
  projectBadgeLabel,
  projectBadgeStyle,
} from "@bb/shared-ui/project-identity";
import { ProjectPickerDisclosure } from "./ProjectPickerDisclosure";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@bb/shared-ui/command";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

interface NewThreadProjectFlowProps {
  projects: readonly { id: string; name: string }[] | undefined;
  projectId: string;
  resetRequest: string | null;
  choosing: boolean;
  onChoosingChange: (choosing: boolean) => void;
  autoFocus: boolean;
  onSelectProject: (projectId: string) => Promise<void>;
  onCompose: () => void;
  onCreateProject: () => void;
  canCreateProject: boolean;
  children: ReactNode;
}

export function NewThreadProjectFlow({
  projects,
  projectId,
  resetRequest,
  choosing,
  onChoosingChange: setChoosing,
  autoFocus,
  onSelectProject,
  onCompose,
  onCreateProject,
  canCreateProject,
  children,
}: NewThreadProjectFlowProps) {
  const [query, setQuery] = useState("");
  const [lastResetRequest, setLastResetRequest] = useState(resetRequest);
  const [error, setError] = useState<string | null>(null);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const generationRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const choices = (projects ?? [])
    .filter((project) => project.id !== PERSONAL_PROJECT_ID)
    .sort((left, right) =>
      left.id === projectId ? -1 : right.id === projectId ? 1 : 0,
    );
  const selectedProject = choices.find((project) => project.id === projectId);
  const loading = projects === undefined;

  if (resetRequest !== null && resetRequest !== lastResetRequest) {
    setLastResetRequest(resetRequest);
    setQuery("");
    setError(null);
  }

  useEffect(() => {
    if (resetRequest === null) return;
    generationRef.current += 1;
    setChoosing(true);
  }, [resetRequest, setChoosing]);

  useEffect(() => {
    if (choosing) return;
    const frame = window.requestAnimationFrame(onCompose);
    return () => window.cancelAnimationFrame(frame);
  }, [choosing, onCompose]);

  const selectProject = async (nextProjectId: string) => {
    if (pendingRef.current || loading) return;
    pendingRef.current = true;
    const generation = generationRef.current;
    setPendingProjectId(nextProjectId);
    setError(null);
    try {
      await onSelectProject(nextProjectId);
      if (generation === generationRef.current) setChoosing(false);
    } catch (cause) {
      setError(
        getMutationErrorMessage({
          error: cause,
          fallbackMessage: "Could not switch projects. Please try again.",
        }),
      );
    } finally {
      pendingRef.current = false;
      setPendingProjectId(null);
    }
  };

  return (
    <section aria-label="New thread" className="w-full space-y-5 py-4 md:py-8">
      <ol
        aria-label="New thread steps"
        className="flex items-center gap-3 text-xs"
      >
        <li aria-current={choosing ? "step" : undefined}>
          <button
            type="button"
            disabled={choosing || pendingProjectId !== null}
            onClick={() => {
              setQuery("");
              setError(null);
              setChoosing(true);
            }}
            className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
              {choosing ? (
                "1"
              ) : (
                <Icon name="Check" className="size-3" aria-hidden />
              )}
            </span>
            <span className="font-medium text-foreground">Project</span>
            {!choosing ? <span className="sr-only">Change project</span> : null}
          </button>
        </li>
        <li aria-hidden className="h-px w-8 bg-border" />
        <li
          aria-current={choosing ? undefined : "step"}
          className={cn(
            "flex items-center gap-2",
            choosing && "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full",
              choosing ? "bg-muted" : "bg-foreground text-background",
            )}
          >
            2
          </span>
          <span>Message</span>
        </li>
      </ol>
      {choosing ? (
        <>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Where would you like to work?
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose a project, then start your thread.
            </p>
          </div>
          <ProjectPickerDisclosure
            key={lastResetRequest ?? "initial"}
            label={selectedProject?.name ?? "Choose a project"}
            autoFocus={autoFocus}
            loading={loading}
            inputRef={inputRef}
            query={query}
            onQueryChange={setQuery}
          >
            <Command
              key={`${resetRequest ?? "project-picker"}-${loading ? "loading" : "ready"}`}
              label="Search projects"
              defaultValue={projectId}
              loop
              onKeyDownCapture={(event) => {
                if (event.key !== "Escape" || query.length === 0) return;
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }}
            >
              <CommandInput
                ref={inputRef}
                aria-label="Search projects"
                placeholder="Search projects…"
                value={query}
                onValueChange={setQuery}
                className="h-12 text-sm"
              />
              <CommandList
                aria-busy={loading || pendingProjectId !== null}
                className="max-h-[min(24rem,max(10rem,calc(100dvh_-_22rem)))] scroll-py-2 p-2"
              >
                <CommandEmpty>
                  No projects found. Try another name.
                </CommandEmpty>
                {loading ? (
                  <p
                    role="status"
                    className="px-3 py-4 text-sm text-muted-foreground"
                  >
                    Loading projects…
                  </p>
                ) : null}
                {choices.length > 0 ? (
                  <CommandGroup heading="Your projects">
                    {choices.map((project) => (
                      <CommandItem
                        key={project.id}
                        value={project.id}
                        keywords={[project.name]}
                        disabled={pendingProjectId !== null}
                        onSelect={() => void selectProject(project.id)}
                        className="group cursor-pointer gap-3 rounded-lg px-3 py-3"
                      >
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                          style={projectBadgeStyle(
                            projectBadgeLabel(project.name),
                          )}
                        >
                          <Icon name="Folder" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {project.name}
                        </span>
                        {project.id === projectId ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            Last used
                          </span>
                        ) : null}
                        <Icon
                          name={
                            pendingProjectId === project.id
                              ? "Loader2"
                              : "ArrowRight"
                          }
                          className={cn(
                            "text-muted-foreground opacity-0 group-data-[selected=true]:opacity-100",
                            pendingProjectId === project.id &&
                              "animate-spin opacity-100",
                          )}
                          aria-hidden
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null}
                <CommandSeparator className="my-2" />
                <CommandGroup heading="Other options">
                  <CommandItem
                    value={PERSONAL_PROJECT_ID}
                    keywords={["No project", "Personal", "Ask anything"]}
                    disabled={loading || pendingProjectId !== null}
                    onSelect={() => void selectProject(PERSONAL_PROJECT_ID)}
                    className="cursor-pointer gap-3 rounded-lg px-3 py-3"
                  >
                    <Icon
                      name="FolderMinus"
                      className="text-muted-foreground"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div>No project</div>
                      <div className="text-xs text-muted-foreground">
                        Start with a personal workspace
                      </div>
                    </div>
                  </CommandItem>
                  <CommandItem
                    value="create-project"
                    keywords={["New project", "Add project"]}
                    disabled={!canCreateProject || pendingProjectId !== null}
                    onSelect={onCreateProject}
                    className="cursor-pointer gap-3 rounded-lg px-3 py-3"
                  >
                    <Icon
                      name="FolderPlus"
                      className="text-muted-foreground"
                      aria-hidden
                    />
                    New project
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-surface-recessed px-4 py-3 text-xs text-muted-foreground">
              <span>
                <kbd className="font-mono">↑ ↓</kbd> to navigate
              </span>
              <span>
                <kbd className="font-mono">Enter</kbd> to choose
              </span>
              <span>
                <kbd className="font-mono">Esc</kbd> to clear search
              </span>
            </div>
          </ProjectPickerDisclosure>
          {pendingProjectId !== null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Preparing your workspace…
            </p>
          ) : null}
          {error !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Start a thread
              </h1>
              <p className="mt-1 flex min-w-0 text-sm">
                <span
                  className="inline-block max-w-full truncate rounded-md px-2 py-0.5 font-medium"
                  style={
                    selectedProject
                      ? projectBadgeStyle(
                          projectBadgeLabel(selectedProject.name),
                        )
                      : undefined
                  }
                >
                  {selectedProject?.name ?? "Personal workspace"}
                </span>
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                setError(null);
                setChoosing(true);
              }}
            >
              Change project
            </Button>
          </div>
        </>
      )}
      <div hidden={choosing} inert={choosing}>
        {children}
      </div>
    </section>
  );
}
