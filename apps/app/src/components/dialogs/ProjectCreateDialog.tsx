import { useState, type FormEvent } from "react";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";

interface ProjectCreateDialogProps {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
}

export function ProjectCreateDialog({
  open,
  pending,
  onOpenChange,
  onCreate,
}: ProjectCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <ProjectCreateForm pending={pending} onCreate={onCreate} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProjectCreateForm({
  pending,
  onCreate,
}: Pick<ProjectCreateDialogProps, "pending" | "onCreate">) {
  const [name, setName] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending && name.trim()) onCreate(name.trim());
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Create project</DialogTitle>
        <DialogDescription>
          A space for related threads. You can attach folders in project
          settings whenever you need them.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={submit}>
        <Input
          aria-label="Project name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Project name"
          autoCapitalize="words"
          disabled={pending}
        />
        <DialogFooter>
          <Button type="submit" disabled={pending || !name.trim()}>
            Create project
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
