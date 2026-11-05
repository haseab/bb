import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  calls: [] as string[],
  newRuntime: false,
  stopped: false,
  backup: false,
  buildExit: 0,
  failInstall: false,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  open: vi.fn(),
  realpath: vi.fn(),
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith("restart/state.json"))
      return JSON.stringify(fixture.state);
    if (
      path.endsWith("restart/command.json") ||
      (path.includes(".bb-previous.app") && !fixture.backup)
    ) {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
    if (path.endsWith("bb-app-runtime.json"))
      return JSON.stringify({
        pid: fixture.newRuntime ? 456 : 123,
        entryPath:
          "/Applications/bb.app/Contents/Resources/app.asar.unpacked/dist/bb-app-bridge.mjs",
        serverUrl: "http://127.0.0.1:38886",
      });
    return Buffer.from("matching bundle");
  }),
  writeFile: vi.fn(async (path: string, data: string) => {
    if (path.includes("state.json.")) fixture.state = JSON.parse(data);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    fixture.calls.push(`rename:${from}:${to}`);
    if (from === "/Applications/.bb-install-staging.app" && fixture.failInstall)
      throw new Error("install failed");
    if (to === "/Applications/.bb-previous.app") fixture.backup = true;
    if (from === "/Applications/.bb-previous.app") fixture.backup = false;
  }),
  rm: vi.fn(async (path: string) => {
    fixture.calls.push(`remove:${path}`);
  }),
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", fixture.buildExit));
    return child;
  }),
  execFile: vi.fn((command: string, args: string[], ...rest: unknown[]) => {
    const callback = rest.at(-1) as (
      error: Error | null,
      result: { stdout: string; stderr: string },
    ) => void;
    fixture.calls.push(`${command}:${args.join(" ")}`);
    let stdout = "";
    if (command === "ps")
      stdout =
        fixture.stopped && !fixture.newRuntime
          ? ""
          : [
              "100 /Applications/bb.app/Contents/MacOS/bb",
              "101 /Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/server/dist/index.js",
              "102 /Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/daemon-bundle.mjs",
              `${fixture.newRuntime ? 456 : 123} /Applications/bb.app/Contents/Resources/app.asar.unpacked/dist/bb-app-bridge.mjs`,
            ].join("\n");
    if (command === "osascript") fixture.stopped = true;
    if (command === "open") fixture.newRuntime = !fixture.failInstall;
    callback(null, { stdout, stderr: "" });
  }),
}));

import { runRestartWorker } from "../src/local-restart-coordinator";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  Object.assign(fixture, {
    state: {
      id: "job",
      phase: "building",
      workerPid: null,
      checkout: "/checkout",
      appPath: "/Applications/bb.app",
      logPath: "/log",
      message: null,
      updatedAt: 0,
    },
    calls: [],
    newRuntime: false,
    stopped: false,
    backup: false,
    buildExit: 0,
    failInstall: false,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      fixture.calls.push(`fetch:${url}`);
      if (options?.method === "POST")
        return Response.json({
          runtimeId: fixture.newRuntime ? "new" : "old",
          paused: true,
          committed: false,
          runningThreadCount: 0,
          inFlightCount: 0,
          job: null,
        });
      return url.endsWith("/health")
        ? Response.json({ ok: true })
        : new Response("matching bundle");
    }),
  );
}

describe("detached restart worker lifecycle", () => {
  it("leaves the running app untouched if the build fails", async () => {
    setup();
    fixture.buildExit = 1;
    await runRestartWorker("job");
    expect(fixture.state.phase).toBe("failed");
    expect(
      fixture.calls.some(
        (call) =>
          call.startsWith("osascript:") ||
          call.startsWith("rename:/Applications"),
      ),
    ).toBe(false);
  });
  it("keeps the old app until the installed frontend and runtime are verified", async () => {
    setup();
    await runRestartWorker("job");
    expect(fixture.state.phase).toBe("complete");
    const quit = fixture.calls.findIndex((call) =>
      call.startsWith("osascript:"),
    );
    const gate = fixture.calls.findIndex((call) =>
      call.includes("/api/v1/system/local-restart"),
    );
    const verified = fixture.calls.lastIndexOf("fetch:http://127.0.0.1:38886");
    const removeBackup = fixture.calls.indexOf(
      "remove:/Applications/.bb-previous.app",
    );
    expect(gate).toBeGreaterThan(-1);
    expect(quit).toBeGreaterThan(gate);
    expect(removeBackup).toBeGreaterThan(verified);
    expect(verified).toBeGreaterThan(quit);
  });
  it("restores and relaunches the old app if installing the staged app fails", async () => {
    setup();
    fixture.failInstall = true;
    await runRestartWorker("job");
    expect(fixture.state.phase).toBe("failed");
    expect(fixture.calls).toContain(
      "rename:/Applications/.bb-previous.app:/Applications/bb.app",
    );
    expect(fixture.calls).toContain("open:-a /Applications/bb.app");
    expect(fixture.calls).not.toContain(
      "remove:/Applications/.bb-previous.app",
    );
  });
});
