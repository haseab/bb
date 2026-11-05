import { useSetAtom } from "jotai";
import { atom } from "jotai";
import { useCallback } from "react";
import { PERSONAL_PROJECT_ID } from "@bb/domain";

export const projectEditorProjectIdAtom = atom<string | null>(null);

export function useProjectEditor(): (projectId: string) => void {
  const setProjectId = useSetAtom(projectEditorProjectIdAtom);
  return useCallback(
    (projectId: string) => {
      if (projectId !== PERSONAL_PROJECT_ID) setProjectId(projectId);
    },
    [setProjectId],
  );
}
