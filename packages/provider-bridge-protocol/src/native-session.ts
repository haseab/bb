import { threadEventUserContentSchema } from "@bb/domain";
import { z } from "zod";
import { threadDeltaSchema } from "./thread-delta.js";

export const nativeSessionSnapshotSchema = z
  .object({
    hostId: z.string().min(1),
    providerId: z.string().min(1),
    providerThreadId: z.string().min(1),
    cwd: z.string().min(1),
    title: z.string(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    active: z.boolean(),
    turns: z
      .array(
        z.object({
          id: z.string().min(1),
          createdAt: z.number().int().nonnegative(),
          completedAt: z.number().int().nonnegative().nullable(),
          deltas: z.array(threadDeltaSchema).max(20_000),
          userMessages: z.array(
            z.object({
              id: z.string(),
              content: z.array(threadEventUserContentSchema),
            }),
          ),
        }),
      )
      .max(100),
  })
  .strict();

export type NativeSessionSnapshot = z.infer<typeof nativeSessionSnapshotSchema>;
export type NativeSessionSyncResult = {
  threadId: string | null;
  status: "synced" | "busy" | "unmapped" | "hidden";
};
