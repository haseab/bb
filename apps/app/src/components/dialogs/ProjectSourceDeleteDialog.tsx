import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@bb/shared-ui/confirm-delete-dialog";

export interface ProjectSourceDeleteDialogTarget {
  id: string;
  label: string;
}

interface ProjectSourceDeleteDialogProps {
  target: ProjectSourceDeleteDialogTarget | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (sourceId: string) => void;
}

export function ProjectSourceDeleteDialog({
  target,
  pending,
  onOpenChange,
  onDelete,
}: ProjectSourceDeleteDialogProps) {
  return (
    <ConfirmDeleteDialog open={target !== null} onOpenChange={onOpenChange}>
      {target ? (
        <ProjectSourceDeleteDialogContent
          target={target}
          pending={pending}
          onDelete={onDelete}
        />
      ) : null}
    </ConfirmDeleteDialog>
  );
}

interface ProjectSourceDeleteDialogContentProps {
  target: ProjectSourceDeleteDialogTarget;
  pending: boolean;
  onDelete: (sourceId: string) => void;
}

export function ProjectSourceDeleteDialogContent({
  target,
  pending,
  onDelete,
}: ProjectSourceDeleteDialogContentProps) {
  return (
    <ConfirmDeleteDialogContent
      title="Remove folder?"
      description={`Detach "${target.label}" from this project? Files on disk and existing threads are kept.`}
      confirmLabel="Remove folder"
      pending={pending}
      onConfirm={() => onDelete(target.id)}
    />
  );
}
