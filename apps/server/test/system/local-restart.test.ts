import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withTestHarness } from "../helpers/test-app.js";
import {
  seedThread,
  seedProjectWithSource,
  seedHost,
} from "../helpers/seed.js";
import {
  initializeRestartAdmission,
  localRestartStatus,
  controlLocalRestart,
} from "../../src/services/system/local-restart.js";
import { describe, expect, it } from "vitest";
import { createRestartAdmissionGate } from "../../src/services/system/local-restart.js";

const token = "54a75f01-5040-400a-8d65-d322faac83b5";

describe("restart admission", () => {
  it("holds new sends while allowing admitted nested work to finish", async () => {
    const gate = createRestartAdmissionGate();
    await gate.run(async (allowed) => {
      expect(allowed).toBe(true);
      gate.control("acquire", token, 0);
      await gate.run(async (nested) => expect(nested).toBe(true));
      expect(() => gate.control("commit", token, 0)).toThrow();
    });
    await gate.run(async (allowed) => expect(allowed).toBe(false));
    expect(() => gate.control("commit", token, 1)).toThrow();
    gate.control("commit", token, 0);
    expect(gate.status()).toMatchObject({
      paused: true,
      committed: true,
      inFlightCount: 0,
    });
    gate.control("release", token, 0);
    await gate.run(async (allowed) => expect(allowed).toBe(true));
  });

  it("does not let a delayed callback reuse a completed admission", async () => {
    const gate = createRestartAdmissionGate();
    let resume!: () => void;
    const barrier = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let delayed!: Promise<boolean>;
    await gate.run(async () => {
      delayed = barrier.then(() => gate.run(async (allowed) => allowed));
    });
    gate.control("acquire", token, 0);
    resume();
    expect(await delayed).toBe(false);
  });

  it("expires abandoned holds and rejects stale or foreign owners", () => {
    let now = 0;
    const gate = createRestartAdmissionGate(() => now);
    gate.control("acquire", token, 0);
    expect(() => gate.control("release", "different", 0)).toThrow();
    now = 119_999;
    expect(gate.status().paused).toBe(true);
    gate.control("renew", token, 0);
    now += 120_000;
    expect(gate.status().paused).toBe(false);
    expect(() => gate.control("commit", token, 0)).toThrow();
  });

  it("allows an explicitly forced commit while busy", () => {
    const gate = createRestartAdmissionGate();
    const send = gate.enter();
    gate.control("acquire", token, 3);
    gate.control("commit", token, 3, true);
    expect(gate.status().committed).toBe(true);
    send.release();
    send.release();
    expect(gate.status().inFlightCount).toBe(0);
  });
});

describe("restart recovery", () => {
  it("recovers the admission hold before queued work starts and counts stopping threads", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      seedThread(harness.deps, { projectId: project.id, status: "active" });
      seedThread(harness.deps, { projectId: project.id, status: "starting" });
      seedThread(harness.deps, { projectId: project.id, status: "stopping" });
      seedThread(harness.deps, { projectId: project.id, status: "idle" });
      const id = randomUUID();
      const dataDir = harness.deps.config.dataDir;
      await mkdir(join(dataDir, "restart"), { recursive: true });
      await writeFile(
        join(dataDir, "restart/state.json"),
        JSON.stringify({
          id,
          phase: "verifying",
          workerPid: process.pid,
          checkout: "/checkout",
          appPath: "/Applications/bb.app",
          logPath: "/log",
          message: null,
          updatedAt: Date.now(),
        }),
      );
      await initializeRestartAdmission(harness.db, dataDir);
      expect(await localRestartStatus(harness.db, dataDir)).toMatchObject({
        paused: true,
        runningThreadCount: 3,
        job: { id },
      });
      await expect(
        controlLocalRestart(harness.db, dataDir, {
          action: "commit",
          token: id,
        }),
      ).rejects.toMatchObject({ body: { code: "restart_busy" } });
      await expect(
        controlLocalRestart(harness.db, dataDir, { action: "cancel", id }),
      ).rejects.toMatchObject({ body: { code: "restart_not_pending" } });
      await controlLocalRestart(harness.db, dataDir, {
        action: "release",
        token: id,
      });
      expect((await localRestartStatus(harness.db, dataDir)).paused).toBe(
        false,
      );
    });
  });
});
