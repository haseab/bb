import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const codexAiRpcContract = defineRpcContract({
  "ai.complete": {
    input: z.object({ prompt: z.string().min(1).max(24_000) }).strict(),
    output: z.object({ text: z.string() }).strict(),
  },
});
