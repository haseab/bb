import { AsyncLocalStorage } from "node:async_hooks";
import { inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { threads, type DbQueryConnection } from "@bb/db";
import {
  localRestartJobSchema,
  type LocalRestartCommand,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";

export function createRestartAdmissionGate(now = Date.now) {
  const runtimeId = randomUUID();
  let active = 0;
  const context = new AsyncLocalStorage<{ allowed: boolean; open: boolean }>();
  let lease: { token: string; expiresAt: number; committed: boolean } | null =
    null;
  const current = () => {
    if (lease !== null && lease.expiresAt <= now()) lease = null;
    return lease;
  };
  const gate = {
    enter() {
      const allowed = current() === null;
      active += 1;
      let released = false;
      return {
        allowed,
        release() {
          if (!released) {
            released = true;
            active -= 1;
          }
        },
      };
    },
    async run<T>(operation: (allowed: boolean) => Promise<T>): Promise<T> {
      const inherited = context.getStore();
      if (inherited?.open) return operation(inherited.allowed);
      const admission = gate.enter();
      const scope = { allowed: admission.allowed, open: true };
      return context.run(scope, async () => {
        try {
          return await operation(admission.allowed);
        } finally {
          scope.open = false;
          admission.release();
        }
      });
    },
    status() {
      const value = current();
      return {
        runtimeId,
        paused: value !== null,
        committed: value?.committed ?? false,
        inFlightCount: active,
      };
    },
    control(
      action: "acquire" | "renew" | "release" | "commit",
      token: string,
      running: number,
      force = false,
    ) {
      const value = current();
      if (action === "acquire") {
        if (value && value.token !== token)
          throw new ApiError(
            409,
            "restart_in_progress",
            "Another restart holds admission",
          );
        lease = {
          token,
          expiresAt: now() + 120_000,
          committed: value?.committed ?? false,
        };
      } else {
        if (!value || value.token !== token)
          throw new ApiError(
            409,
            "restart_lease_lost",
            "Restart admission lease was lost",
          );
        if (action === "release") lease = null;
        else {
          if (action === "commit" && !force && (running > 0 || active > 0))
            throw new ApiError(
              409,
              "restart_busy",
              "Waiting for running threads and in-flight dispatches",
            );
          value.expiresAt = now() + 120_000;
          if (action === "commit") value.committed = true;
        }
      }
    },
  };
  return gate;
}
function runningCount(db: DbQueryConnection): number {
  return db
    .select({ id: threads.id })
    .from(threads)
    .where(inArray(threads.status, ["starting", "active", "stopping"]))
    .all().length;
}
const gates = new WeakMap<
  DbQueryConnection,
  ReturnType<typeof createRestartAdmissionGate>
>();
export function restartAdmissionGate(db: DbQueryConnection) {
  let gate = gates.get(db);
  if (!gate) {
    gate = createRestartAdmissionGate();
    gates.set(db, gate);
  }
  return gate;
}
export async function localRestartStatus(
  db: DbQueryConnection,
  dataDir: string,
) {
  let job = null;
  try {
    job = localRestartJobSchema.parse(
      JSON.parse(
        await readFile(join(dataDir, "restart", "state.json"), "utf8"),
      ),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  return {
    ...restartAdmissionGate(db).status(),
    runningThreadCount: runningCount(db),
    job,
  };
}
export async function controlLocalRestart(
  db: DbQueryConnection,
  dataDir: string,
  command: LocalRestartCommand,
) {
  if ("id" in command) {
    const status = await localRestartStatus(db, dataDir);
    if (
      !status.job ||
      status.job.id !== command.id ||
      ["complete", "failed", "cancelled", "installing", "verifying"].includes(
        status.job.phase,
      )
    )
      throw new ApiError(
        409,
        "restart_not_pending",
        "No matching pending restart",
      );
    const folder = join(dataDir, "restart");
    await mkdir(folder, { recursive: true });
    const pending = join(folder, `command-${randomUUID()}.tmp`);
    await writeFile(
      pending,
      JSON.stringify({ id: command.id, action: command.action }),
    );
    await rename(pending, join(folder, "command.json"));
  } else {
    restartAdmissionGate(db).control(
      command.action,
      command.token,
      runningCount(db),
      command.action === "commit" && command.force === true,
    );
  }
  return localRestartStatus(db, dataDir);
}

export async function initializeRestartAdmission(
  db: DbQueryConnection,
  dataDir: string,
) {
  try {
    const job = localRestartJobSchema.parse(
      JSON.parse(
        await readFile(join(dataDir, "restart", "state.json"), "utf8"),
      ),
    );
    if (
      !["installing", "verifying"].includes(job.phase) ||
      job.workerPid === null
    )
      return;
    try {
      process.kill(job.workerPid, 0);
    } catch {
      return;
    }
    restartAdmissionGate(db).control("acquire", job.id, 0);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}
