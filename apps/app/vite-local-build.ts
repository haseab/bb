import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import type { Plugin } from "vite";

const revisionSchema = z.object({
  revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
});
const packageSchema = z.object({ version: z.string().min(1) });
const virtualId = "virtual:bb-local-build";
const resolvedId = `\0${virtualId}`;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function readLocalBuildVersion(
  statePath: string,
  version: string,
): Promise<string> {
  try {
    const { revision } = revisionSchema.parse(
      JSON.parse(await readFile(statePath, "utf8")),
    );
    return `${version}.${revision}`;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return `${version}.0`;
    throw error;
  }
}

export async function reserveLocalBuildVersion(
  statePath: string,
  version: string,
): Promise<string> {
  await mkdir(dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`;
  let lock;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      lock = await open(lockPath, "wx");
      break;
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      await setTimeout(20);
    }
  }
  if (lock === undefined)
    throw new Error("Another process is updating the local build version");
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    let revision = 0;
    try {
      revision = revisionSchema.parse(
        JSON.parse(await readFile(statePath, "utf8")),
      ).revision;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    revision++;
    await writeFile(temporaryPath, JSON.stringify({ revision }) + "\n");
    await rename(temporaryPath, statePath);
    return `${version}.${revision}`;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
    await rm(temporaryPath, { force: true });
  }
}

export function localBuildVersionPlugin(): Plugin {
  let statePath = "";
  let releaseVersion = "";
  let version = "";
  return {
    name: "bb:local-build-version",
    async configResolved(config) {
      statePath = resolve(config.root, "../../.bb/local-build-revision.json");
      releaseVersion = packageSchema.parse(
        JSON.parse(
          await readFile(
            resolve(config.root, "../desktop/package.json"),
            "utf8",
          ),
        ),
      ).version;
      const requestedVersion = process.env.BB_LOCAL_BUILD_VERSION;
      if (config.command === "serve") {
        version = await readLocalBuildVersion(statePath, releaseVersion);
      } else if (requestedVersion !== undefined) {
        const revision = requestedVersion.slice(releaseVersion.length + 1);
        if (
          !requestedVersion.startsWith(`${releaseVersion}.`) ||
          !/^[1-9]\d*$/u.test(revision)
        )
          throw new Error(
            "Local build version must match the release being built",
          );
        version = requestedVersion;
      } else {
        version = await reserveLocalBuildVersion(statePath, releaseVersion);
      }
    },
    resolveId(id) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(id) {
      return id === resolvedId
        ? `export const localBuildVersion = ${JSON.stringify(version)};`
        : undefined;
    },
    configureServer(server) {
      server.middlewares.use("/local-build.json", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify({ localBuildVersion: version }));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "local-build.json",
        source: JSON.stringify({ localBuildVersion: version }) + "\n",
      });
    },
  };
}
