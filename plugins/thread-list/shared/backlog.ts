import { z } from "zod";

export const BACKLOG_CHANGED_CHANNEL = "backlog";
export const backlogItemSchema = z.object({
  threadId: z.string(),
  sectionId: z.string(),
  enteredAt: z.number().int(),
  followUpAt: z.number().int().nullable(),
  refreshAt: z.number().int(),
  refreshedAt: z.number().int().nullable(),
  stage: z.enum(["backlog", "refreshing", "refreshed"]),
});
export type BacklogItem = z.infer<typeof backlogItemSchema>;
export const backlogStateSchema = z.object({
  sectionId: z.string().nullable(),
  items: z.array(backlogItemSchema),
});
export type BacklogState = z.infer<typeof backlogStateSchema>;
export const backlogRpcContract = {
  backlogState: { input: z.null(), output: backlogStateSchema },
  scheduleFollowUp: {
    input: z
      .object({
        threadId: z.string().min(1),
        input: z.string().trim().min(1).max(256),
        timeZone: z.string().min(1).max(128),
        onlyBacklog: z.boolean().optional(),
      })
      .strict(),
    output: backlogStateSchema,
  },
  clearFollowUp: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: backlogStateSchema,
  },
};
