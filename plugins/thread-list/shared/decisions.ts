import { z } from "zod";

export const DECISIONS_CHANGED_CHANNEL = "quick-decisions";
export const decisionLevelSchema = z.enum(["normal", "quick", "instant"]);
export const decisionResultSchema = z
  .object({
    level: decisionLevelSchema,
    reason: z.string().trim().max(160),
  })
  .strict();
export const quickDecisionSchema = decisionResultSchema.extend({
  threadId: z.string(),
  requestKey: z.string(),
  interactionId: z.string().nullable(),
  classifiedAt: z.number(),
});
export type QuickDecision = z.infer<typeof quickDecisionSchema>;
export const quickDecisionsStateSchema = z
  .object({ items: z.array(quickDecisionSchema) })
  .strict();
export type QuickDecisionsState = z.infer<typeof quickDecisionsStateSchema>;
export const decisionsRpcContract = {
  decisionsState: { input: z.null(), output: quickDecisionsStateSchema },
  refreshDecision: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: quickDecisionsStateSchema,
  },
};
