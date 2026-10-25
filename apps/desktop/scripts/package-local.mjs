import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { reserveLocalBuildVersion } from "../../app/vite-local-build.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { version } = z
  .object({ version: z.string().min(1) })
  .parse(
    JSON.parse(
      await readFile(resolve(repoRoot, "apps/desktop/package.json"), "utf8"),
    ),
  );
const localVersion = await reserveLocalBuildVersion(
  resolve(repoRoot, ".bb/local-build-revision.json"),
  version,
);
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "turbo",
    "run",
    "package",
    "--filter=@bb/desktop",
    "--output-logs=errors-only",
    ...process.argv.slice(2),
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, BB_LOCAL_BUILD_VERSION: localVersion },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
