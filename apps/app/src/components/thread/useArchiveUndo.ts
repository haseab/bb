import { useCallback, useEffect, useRef } from "react";
import { appToast, type AppToastOptions } from "@/components/ui/app-toast";

interface ArchiveUndo {
  expiresAt: number;
  run: () => void;
}

export function useArchiveUndo() {
  const pending = useRef(new Map<string, ArchiveUndo>());

  useEffect(() => {
    const actions = pending.current;
    const invalidate = () => actions.clear();
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "z"
      )
        return;
      for (const [id, action] of [...actions].reverse()) {
        if (action.expiresAt <= Date.now()) {
          actions.delete(id);
          continue;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        action.run();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("beforeinput", invalidate, true);
    window.addEventListener("input", invalidate, true);
    return () => {
      actions.clear();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("beforeinput", invalidate, true);
      window.removeEventListener("input", invalidate, true);
    };
  }, []);

  return useCallback(
    (id: string, undo: () => void, duration: number): AppToastOptions => {
      let consumed = false;
      const action: ArchiveUndo = {
        expiresAt: Date.now() + duration,
        run: () => {
          if (consumed) return;
          consumed = true;
          if (pending.current.get(id) === action) pending.current.delete(id);
          appToast.dismiss(id);
          undo();
        },
      };
      pending.current.delete(id);
      pending.current.set(id, action);
      const remove = () => {
        if (pending.current.get(id) === action) pending.current.delete(id);
      };
      return {
        cancel: { label: "Undo", onClick: action.run },
        onDismiss: remove,
        onAutoClose: remove,
      };
    },
    [],
  );
}
