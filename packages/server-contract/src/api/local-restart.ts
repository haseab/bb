import { z } from "zod";

export const localRestartJobSchema = z.object({
  id: z.string(),
  phase: z.enum([
    "building",
    "waiting",
    "blocked",
    "installing",
    "verifying",
    "complete",
    "cancelled",
    "failed",
  ]),
  workerPid: z.number().int().nullable(),
  checkout: z.string(),
  appPath: z.string(),
  logPath: z.string(),
  message: z.string().nullable(),
  updatedAt: z.number(),
});
export const localRestartStatusSchema = z.object({
  runtimeId: z.string(),
  paused: z.boolean(),
  committed: z.boolean(),
  runningThreadCount: z.number().int().nonnegative(),
  inFlightCount: z.number().int().nonnegative(),
  job: localRestartJobSchema.nullable(),
});
export const localRestartCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum(["acquire", "renew", "release"]),
      token: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("commit"),
      token: z.string().uuid(),
      force: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ action: z.enum(["cancel", "now"]), id: z.string().uuid() })
    .strict(),
]);
export type LocalRestartStatus = z.infer<typeof localRestartStatusSchema>;
export type LocalRestartCommand = z.infer<typeof localRestartCommandSchema>;
