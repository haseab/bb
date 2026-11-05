import { randomUUID, createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  open,
  readFile,
  rename,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  localRestartJobSchema,
  localRestartStatusSchema,
} from "@bb/server-contract";

const execute = promisify(execFile);
const root = resolve(__dirname, "../../..");
const dataDir = join(homedir(), ".bb");
const folder = join(dataDir, "restart");
const statePath = join(folder, "state.json");
const commandPath = join(folder, "command.json");
const lockPath = join(folder, "lock");
const installed = "/Applications/bb.app";
const staging = "/Applications/.bb-install-staging.app";
const backup = "/Applications/.bb-previous.app";
const bridge = "Contents/Resources/app.asar.unpacked/dist/bb-app-bridge.mjs";
const runtime = "Contents/Resources/app.asar.unpacked/node_modules/bb-app";
const required = [
  "Contents/MacOS/bb",
  "Contents/Resources/app.asar",
  bridge,
  `${runtime}/server/dist/index.js`,
  `${runtime}/host-daemon/dist/daemon-bundle.mjs`,
  `${runtime}/app/dist/index.html`,
];
const commandSchema = z.object({
  id: z.string(),
  action: z.enum(["cancel", "now"]),
});
const runtimeSchema = z.object({
  pid: z.number().int(),
  entryPath: z.string(),
  serverUrl: z.string().url(),
});
const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const digest = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, path);
}
export async function readRestartJob() {
  try {
    return localRestartJobSchema.parse(
      JSON.parse(await readFile(statePath, "utf8")),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
async function readCommand(id: string) {
  try {
    const command = commandSchema.parse(
      JSON.parse(await readFile(commandPath, "utf8")),
    );
    return command.id === id ? command.action : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
export async function signalRestart(action: "cancel" | "now") {
  const job = await readRestartJob();
  if (!job || !["building", "waiting", "blocked"].includes(job.phase))
    throw new Error("No cancellable restart is pending");
  await writeJson(commandPath, { id: job.id, action });
  return job;
}
async function externalNode() {
  const candidates = [
    process.execPath,
    ...(await execute("which", ["-a", "node"])).stdout.trim().split("\n"),
  ];
  for (const candidate of candidates) {
    const path = await realpath(candidate);
    if (path.startsWith(installed + "/")) continue;
    const version = (await execute(path, ["--version"])).stdout.trim();
    if (Number(version.match(/^v(\d+)/)?.[1] ?? 0) >= 24) return path;
  }
  throw new Error(
    "An external Node.js 24+ is required so the coordinator survives replacing BB",
  );
}

export async function startLocalRestart(checkout = root, force = false) {
  if (process.platform !== "darwin")
    throw new Error("The local .app restart coordinator requires macOS");
  if (resolve(checkout) !== root)
    throw new Error("Run the coordinator from the normal BB checkout");
  await mkdir(folder, { recursive: true });
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
    const old = await readRestartJob();
    if (
      old &&
      ((old.workerPid !== null && processAlive(old.workerPid)) ||
        Date.now() - old.updatedAt < 10_000)
    )
      throw new Error(
        "A restart is already pending; use status, cancel, or now",
      );
    await rm(lockPath, { recursive: true });
    await mkdir(lockPath);
  }
  const job = {
    id: randomUUID(),
    phase: "building" as const,
    workerPid: null,
    checkout: root,
    appPath: installed,
    logPath: join(folder, "build.log"),
    message: null,
    updatedAt: Date.now(),
  };
  try {
    await writeJson(statePath, job);
    if (force) await writeJson(commandPath, { id: job.id, action: "now" });
    const log = await open(job.logPath, "w");
    try {
      const child = spawn(
        await externalNode(),
        [
          "--import",
          "tsx",
          join(root, "apps/desktop/scripts/restart-local.mjs"),
          "worker",
          job.id,
        ],
        { cwd: root, detached: true, stdio: ["ignore", log.fd, log.fd] },
      );
      await new Promise<void>((ok, fail) => {
        child.once("spawn", ok);
        child.once("error", fail);
      });
      child.unref();
      return { ...job, workerPid: child.pid ?? null };
    } finally {
      await log.close();
    }
  } catch (error) {
    await writeJson(statePath, {
      ...job,
      phase: "failed",
      message: error instanceof Error ? error.message : String(error),
      updatedAt: Date.now(),
    }).catch(() => {});
    await rm(lockPath, { recursive: true, force: true });
    throw error;
  }
}

export async function waitForRestartWindow(args: {
  command(): Promise<"cancel" | "now" | null>;
  control(
    action: "acquire" | "renew" | "commit",
    force: boolean,
  ): Promise<{
    runtimeId: string;
    runningThreadCount: number;
    inFlightCount: number;
  }>;
  waiting(count: number, blocked: boolean): Promise<void>;
  sleep(): Promise<void>;
}) {
  let held = false;
  let identity: string | null = null;
  let force = false;
  while (true) {
    const command = await args.command();
    if (command === "cancel") throw new Error("restart_cancelled");
    if (command === "now") force = true;
    let status;
    try {
      status = await args.control(held ? "renew" : "acquire", force);
      if (identity !== null && identity !== status.runtimeId)
        throw new Error("The running runtime changed while waiting");
      identity = status.runtimeId;
      held = true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "restart_gate_unavailable"
      ) {
        if (force) return { force: true, gated: false };
        await args.waiting(0, true);
        await args.sleep();
        continue;
      }
      throw error;
    }
    const busy = status.runningThreadCount + status.inFlightCount;
    if (force || busy === 0) {
      try {
        await args.control("commit", force);
        return { force, gated: true };
      } catch (error) {
        if (!(error instanceof Error && error.message === "restart_busy"))
          throw error;
      }
    }
    await args.waiting(busy, false);
    await args.sleep();
  }
}

export async function runRestartWorker(id: string) {
  const initial = await readRestartJob();
  if (!initial || initial.id !== id)
    throw new Error("Restart job was replaced");
  let job = initial;
  job.workerPid = process.pid;
  let phase = job.phase;
  let swapped = false;
  let verifiedSuccessfully = false;
  let quit = false;
  let serverUrl: string | null = null;
  let leaseHeld = false;
  let build: ReturnType<typeof spawn> | null = null;
  let cancelled = false;
  let pollBusy = false;
  const update = async (
    next: typeof job.phase,
    message: string | null = null,
  ) => {
    if (!job) return;
    phase = next;
    job = { ...job, phase: next, message, updatedAt: Date.now() };
    await writeJson(statePath, job);
  };
  const checkCancelled = async () => {
    if (cancelled || (await readCommand(id)) === "cancel") {
      cancelled = true;
      throw new Error("restart_cancelled");
    }
  };
  const control = async (
    action: "acquire" | "renew" | "release" | "commit",
    force = false,
  ) => {
    if (!serverUrl) throw new Error("Runtime URL is not available");
    const response = await fetch(`${serverUrl}/api/v1/system/local-restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "commit"
          ? { action, token: id, force }
          : { action, token: id },
      ),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) throw new Error("restart_gate_unavailable");
    if (response.status === 409) {
      const body = z
        .object({ code: z.string().optional(), message: z.string().optional() })
        .passthrough()
        .parse(await response.json());
      if (body.code === "restart_busy") throw new Error("restart_busy");
      throw new Error(body.message ?? body.code ?? "Restart lease was refused");
    }
    if (!response.ok)
      throw new Error(`Restart admission request failed: ${response.status}`);
    const status = localRestartStatusSchema.parse(await response.json());
    if (action === "acquire") leaseHeld = true;
    if (action === "release") leaseHeld = false;
    return status;
  };
  const timer = setInterval(() => {
    if (pollBusy) return;
    pollBusy = true;
    void (async () => {
      if (
        ["building", "waiting", "blocked"].includes(phase) &&
        (await readCommand(id)) === "cancel"
      ) {
        cancelled = true;
        if (build?.pid) {
          try {
            process.kill(-build.pid, "SIGTERM");
          } catch {}
        }
      }
      if (leaseHeld && ["installing", "verifying"].includes(phase))
        await control("renew");
    })()
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        pollBusy = false;
      });
  }, 3000);
  const processRows = async () =>
    (await execute("ps", ["-axo", "pid=,command="])).stdout
      .split("\n")
      .flatMap((line) => {
        const match = line.trim().match(/^(\d+)\s+(.*)$/);
        return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
      });
  const stop = async (pid: number, token: string) => {
    if (
      !(await processRows()).some(
        (row) => row.pid === pid && row.command.includes(token),
      )
    )
      return;
    process.kill(pid, "SIGTERM");
    for (let pass = 0; pass < 40; pass++) {
      if (!processAlive(pid)) return;
      await delay(250);
    }
    if (
      (await processRows()).some(
        (row) => row.pid === pid && row.command.includes(token),
      )
    )
      process.kill(pid, "SIGKILL");
    for (let pass = 0; pass < 40 && processAlive(pid); pass++) await delay(250);
    if (processAlive(pid))
      throw new Error(`Old runtime process did not stop: ${pid}`);
  };
  try {
    await update("building");
    await new Promise<void>((ok, fail) => {
      build = spawn("pnpm", ["desktop:package"], {
        cwd: root,
        stdio: "inherit",
        detached: true,
      });
      build.once("error", fail);
      build.once("exit", (code) =>
        code === 0
          ? ok()
          : fail(
              new Error(
                cancelled ? "restart_cancelled" : `Build failed (${code})`,
              ),
            ),
      );
    });
    build = null;
    await checkCancelled();
    const built = join(root, "apps/desktop/release/mac-arm64/bb.app");
    const hashes = new Map<string, string>();
    for (const path of required)
      hashes.set(path, await digest(join(built, path)));
    await execute("codesign", ["--verify", "--deep", "--strict", built]);
    try {
      await readFile(join(backup, "Contents/Info.plist"));
      throw new Error(
        "A previous app backup needs recovery before another restart",
      );
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
    await rm(staging, { recursive: true, force: true });
    await execute("ditto", [built, staging]);
    for (const [path, hash] of hashes)
      if ((await digest(join(staging, path))) !== hash)
        throw new Error(`Staged bundle mismatch: ${path}`);
    const oldRuntime = runtimeSchema.parse(
      JSON.parse(await readFile(join(dataDir, "bb-app-runtime.json"), "utf8")),
    );
    if (oldRuntime.entryPath !== join(installed, bridge))
      throw new Error(
        "The running runtime is not owned by /Applications/bb.app",
      );
    const origin = new URL(oldRuntime.serverUrl);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
      throw new Error("Restart only operates on the local bundled runtime");
    serverUrl = origin.origin;
    await waitForRestartWindow({
      command: () => readCommand(id),
      control,
      waiting: (count, blocked) =>
        update(
          blocked ? "blocked" : "waiting",
          blocked
            ? "Update ready. The installed runtime needs the new restart gate before automatic installation; cancel or explicitly choose Restart now."
            : `Update ready—waiting for ${count} running thread or dispatch${count === 1 ? "" : "es"}. New work is queued.`,
        ),
      sleep: () => delay(1000),
    });
    await checkCancelled();
    const beforeQuit = runtimeSchema.parse(
      JSON.parse(await readFile(join(dataDir, "bb-app-runtime.json"), "utf8")),
    );
    if (
      beforeQuit.pid !== oldRuntime.pid ||
      beforeQuit.entryPath !== oldRuntime.entryPath
    )
      throw new Error("The running runtime changed before installation");
    if (leaseHeld) await control("renew");
    await update("installing", "Installing verified update");
    const rows = await processRows();
    const appRows = rows.filter(
      (row) => row.command === join(installed, "Contents/MacOS/bb"),
    );
    const runtimeRows = rows.filter((row) =>
      row.command.includes(
        join(installed, "Contents/Resources/app.asar.unpacked/"),
      ),
    );
    if (!appRows.length) throw new Error("The installed BB app is not running");
    quit = true;
    await execute("osascript", ["-e", 'tell application "bb" to quit'], {
      timeout: 20_000,
    }).catch((error: unknown) => console.error(error));
    for (const row of appRows)
      await stop(row.pid, join(installed, "Contents/MacOS/bb"));
    for (const row of runtimeRows)
      await stop(
        row.pid,
        join(installed, "Contents/Resources/app.asar.unpacked/"),
      );
    await rename(installed, backup);
    await rename(staging, installed);
    swapped = true;
    await execute("open", ["-a", installed]);
    await update("verifying", "Verifying the new app and bundled runtime");
    let verified = false;
    for (let pass = 0; pass < 120; pass++) {
      try {
        const current = runtimeSchema.parse(
          JSON.parse(
            await readFile(join(dataDir, "bb-app-runtime.json"), "utf8"),
          ),
        );
        const currentRows = await processRows();
        serverUrl = new URL(current.serverUrl).origin;
        if (
          current.pid === oldRuntime.pid ||
          current.entryPath !== join(installed, bridge) ||
          !currentRows.some(
            (row) => row.command === join(installed, "Contents/MacOS/bb"),
          ) ||
          !currentRows.some(
            (row) =>
              row.pid === current.pid &&
              row.command.includes(join(installed, bridge)),
          ) ||
          !currentRows.some((row) =>
            row.command.includes(
              join(installed, runtime, "server/dist/index.js"),
            ),
          ) ||
          !currentRows.some((row) =>
            row.command.includes(
              join(installed, runtime, "host-daemon/dist/daemon-bundle.mjs"),
            ),
          )
        )
          throw new Error("New runtime is not ready");
        const health = await fetch(`${current.serverUrl}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (
          !health.ok ||
          !z.object({ ok: z.literal(true) }).parse(await health.json()).ok
        )
          throw new Error("Runtime is unhealthy");
        const page = await fetch(current.serverUrl, {
          signal: AbortSignal.timeout(2000),
        });
        if (
          createHash("sha256")
            .update(Buffer.from(await page.arrayBuffer()))
            .digest("hex") !== hashes.get(`${runtime}/app/dist/index.html`)
        )
          throw new Error("Frontend does not match the new bundle");
        verified = true;
        break;
      } catch {
        await delay(1000);
      }
    }
    if (!verified) throw new Error("The updated app could not be verified");
    verifiedSuccessfully = true;
    await rm(backup, { recursive: true });
    await update(
      "complete",
      "BB restarted with its matching bundled frontend and runtime",
    );
  } catch (error) {
    if (quit && !verifiedSuccessfully) {
      try {
        await readFile(join(backup, "Contents/Info.plist"));
        if (swapped) {
          for (const row of await processRows())
            if (row.command.includes(installed + "/"))
              await stop(row.pid, installed);
          await rename(installed, staging);
        }
        await rename(backup, installed);
      } catch (restoreError) {
        console.error("Rollback:", restoreError);
      }
      await execute("open", ["-a", installed]).catch((relaunchError: unknown) =>
        console.error(relaunchError),
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    await update(
      message === "restart_cancelled" ? "cancelled" : "failed",
      message,
    );
    console.error(error);
  } finally {
    clearInterval(timer);
    if (leaseHeld) await control("release").catch(() => {});
    await rm(lockPath, { recursive: true, force: true });
  }
}
