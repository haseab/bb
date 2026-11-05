import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliBbSdk } from "../client.js";
import { registerRestartCommand } from "./restart.js";

const api = vi.hoisted(() => ({
  localRestart: vi.fn(),
  controlLocalRestart: vi.fn(),
}));
vi.mock("../client.js", () => ({
  createCliBbSdk: vi.fn(() => ({ system: api })),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function run(command: string) {
  const status = {
    job: {
      id: "54a75f01-5040-400a-8d65-d322faac83b5",
      phase: "waiting",
      message: "waiting",
    },
  };
  api.localRestart.mockResolvedValue(status);
  api.controlLocalRestart.mockResolvedValue(status);
  vi.spyOn(console, "log").mockImplementation(() => {});
  const program = new Command();
  registerRestartCommand(program, () => "http://127.0.0.1:38886");
  await program.parseAsync(["node", "bb", "restart", command, "--json"]);
}

describe("restart CLI controls", () => {
  it("only inspects a job when status is requested", async () => {
    await run("status");
    expect(createCliBbSdk).toHaveBeenCalledWith("http://127.0.0.1:38886");
    expect(api.controlLocalRestart).not.toHaveBeenCalled();
  });
  it.each(["cancel", "now"])(
    "targets the current job for an explicit %s request",
    async (action) => {
      await run(action);
      expect(api.controlLocalRestart).toHaveBeenCalledExactlyOnceWith({
        action,
        id: "54a75f01-5040-400a-8d65-d322faac83b5",
      });
    },
  );
});
