import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const metadataSchema = z.object({ localBuildVersion: z.string().min(1) });

export async function readLocalBuildVersion(
  frontendDir: string | undefined,
): Promise<string | null> {
  if (frontendDir === undefined) return null;
  try {
    return metadataSchema.parse(
      JSON.parse(await readFile(join(frontendDir, "local-build.json"), "utf8")),
    ).localBuildVersion;
  } catch {
    return null;
  }
}
