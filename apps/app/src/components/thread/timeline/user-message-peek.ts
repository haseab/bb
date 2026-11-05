import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export const threadUserMessagesOnlyAtom = atomFamily((_threadId: string) =>
  atom(false),
);
