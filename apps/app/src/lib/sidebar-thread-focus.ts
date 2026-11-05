import { atom } from "jotai";

export const sidebarThreadFocusRequestAtom = atom<{ threadId: string } | null>(
  null,
);
