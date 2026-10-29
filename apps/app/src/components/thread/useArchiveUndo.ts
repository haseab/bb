import { useCallback } from "react";
import { appToast, type AppToastOptions } from "@/components/ui/app-toast";

export function useArchiveUndo() {
  return useCallback(
    (id: string, undo: () => void, duration: number): AppToastOptions => {
      let consumed = false;
      return {
        duration,
        cancel: {
          label: "Undo",
          onClick: () => {
            if (consumed) return;
            consumed = true;
            appToast.dismiss(id);
            undo();
          },
        },
      };
    },
    [],
  );
}
