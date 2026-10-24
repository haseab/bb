import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_nativeSessionSnapshotSchema as nativeSessionSnapshotSchema } from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

export const codexSessionMetadataSchema = z
  .object({
    id: z.string().min(1),
    cwd: z.string().min(1),
    name: z.string().nullable().optional(),
    preview: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    path: z.string().nullable().optional(),
  })
  .passthrough();
export type CodexSessionMetadata = z.infer<typeof codexSessionMetadataSchema>;

export const codexSessionHostContract = defineRpcContract({
  "sessions.list": {
    input: z.object({
      cwd: z.array(z.string()).min(1).max(200),
      cursor: z.string().nullable(),
    }),
    output: z.object({
      data: z.array(codexSessionMetadataSchema),
      nextCursor: z.string().nullable(),
    }),
  },
  "sessions.read": {
    input: z.object({
      threadId: z.string().min(1),
      cursor: z.string().nullable(),
    }),
    output: z.object({
      session: nativeSessionSnapshotSchema.omit({ hostId: true }),
      nextCursor: z.string().nullable(),
    }),
  },
});

export const codexSessionSyncContract = defineRpcContract({
  "sessions.sync": {
    input: z.object({}).strict(),
    output: z.object({
      synced: z.number(),
      busy: z.number(),
      errors: z.number(),
    }),
  },
});
