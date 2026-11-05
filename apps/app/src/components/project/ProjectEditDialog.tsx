import { useState, type FormEvent } from "react";
import { deriveProjectNameFromPath } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import {
  useAddLocalProjectSource,
  useDeleteLocalProjectSource,
  useUpdateProject,
} from "@/hooks/mutations/project-mutations";
import { selectHosts, useHosts } from "@/hooks/queries/host-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useLocalPathPicker } from "@/hooks/useLocalPathPicker";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

interface ProjectEditDialogProps {
  projectId: string;
  onClose: () => void;
}

export function ProjectEditDialog({
  projectId,
  onClose,
}: ProjectEditDialogProps) {
  const navigation = useSidebarNavigation();
  const project = navigation.data?.projects.find(
    (entry) => entry.id === projectId,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        {project ? (
          <ProjectEditForm
            key={project.id}
            project={project}
            onClose={onClose}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Edit project</DialogTitle>
              <DialogDescription>
                {navigation.isPending
                  ? "Loading project…"
                  : navigation.isError
                    ? "Could not load this project. Please try again."
                    : "This project is no longer available."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProjectEditForm({
  project,
  onClose,
}: {
  project: ProjectResponse;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | null>(null);
  const hostsQuery = useHosts();
  const hosts = selectHosts(hostsQuery.data, "all");
  const update = useUpdateProject({ showErrorToast: false });
  const add = useAddLocalProjectSource();
  const remove = useDeleteLocalProjectSource();
  const busy = update.isPending || add.isPending || remove.isPending;
  const picker = useLocalPathPicker({
    isPending: busy,
    submit: ({ path, hostId, closeDialog }) => {
      setError(null);
      add.mutate(
        { projectId: project.id, path, hostId },
        {
          onSuccess: closeDialog,
          onError: (cause) =>
            setError(
              getMutationErrorMessage({
                error: cause,
                fallbackMessage: "Could not add the folder.",
              }),
            ),
        },
      );
    },
  });
  function saveName(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim() || name.trim() === project.name) return;
    setError(null);
    update.mutate(
      { id: project.id, name: name.trim() },
      {
        onError: (cause) =>
          setError(
            getMutationErrorMessage({
              error: cause,
              fallbackMessage: "Could not save the project name.",
            }),
          ),
      },
    );
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit project</DialogTitle>
        <DialogDescription>
          Manage the folders available to the AI in {project.name}.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={saveName} className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 focus-within:ring-2 focus-within:ring-ring">
          <Icon
            name="Folder"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <Input
            aria-label="Project name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            className="border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={busy || !name.trim() || name.trim() === project.name}
        >
          Save name
        </Button>
      </form>
      <section aria-label="Source folders" className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">
          Source folders{" "}
          <span className="text-muted-foreground">
            ({project.sources.length})
          </span>
        </h3>
        <div className="overflow-hidden rounded-lg border">
          <ul
            className="max-h-72 divide-y overflow-y-auto"
            aria-label="Attached folders"
          >
            {project.sources.map((source) => (
              <li
                key={source.id}
                className="flex min-w-0 items-center gap-3 px-4 py-3"
              >
                <Icon
                  name="Folder"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {deriveProjectNameFromPath(source.path)}
                  </p>
                  <p
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={source.path}
                  >
                    {source.path}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {hosts.find((host) => host.id === source.hostId)?.name ??
                      source.hostId}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Detach ${source.path}`}
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    remove.mutate(
                      { projectId: project.id, sourceId: source.id },
                      {
                        onError: (cause) =>
                          setError(
                            getMutationErrorMessage({
                              error: cause,
                              fallbackMessage: "Could not detach the folder.",
                            }),
                          ),
                      },
                    );
                  }}
                >
                  <Icon name="X" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          {project.sources.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">
              No folders attached. You can add one whenever you need it.
            </p>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center gap-3 border-t px-4 py-3 text-sm hover:bg-state-hover disabled:opacity-50"
            disabled={
              busy || !hosts.some((host) => host.status === "connected")
            }
            onClick={() =>
              picker.openPathEntry({
                kind: "add-source",
                projectId: project.id,
                projectName: project.name,
              })
            }
          >
            <Icon name="FolderPlus" className="size-4 text-muted-foreground" />
            Add folder
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Folder changes save immediately. Detaching a folder keeps its files
          and existing threads.
        </p>
        {hostsQuery.isError ? (
          <p role="alert" className="text-xs text-destructive">
            Could not load machines. Reopen this dialog to try again.
          </p>
        ) : hostsQuery.isSuccess &&
          !hosts.some((host) => host.status === "connected") ? (
          <p className="text-xs text-muted-foreground">
            Connect a machine to browse for folders.
          </p>
        ) : null}
      </section>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" disabled={busy} onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
      <ProjectPathDialog
        target={picker.projectPathDialog.target}
        pending={add.isPending}
        platform={picker.platform}
        hostId={picker.hostId}
        hostName={picker.hostName}
        hosts={hosts}
        onOpenChange={picker.projectPathDialog.onOpenChange}
        onSubmit={picker.submitProjectPath}
      />
    </>
  );
}
