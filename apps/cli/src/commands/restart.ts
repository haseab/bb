import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { access } from "node:fs/promises";
import type { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";

export function registerRestartCommand(program: Command, getUrl: () => string) {
  const restart = program
    .command("restart")
    .description("Build BB now and restart only when running work finishes");
  restart
    .command("start", { isDefault: true })
    .option("--json", "Print JSON")
    .option("--checkout <path>", "Normal BB source checkout", process.cwd())
    .option(
      "--now",
      "Explicitly allow interrupting running threads after the build",
    )
    .action(
      action(async (options: { checkout: string; now?: boolean }) => {
        const checkout = resolve(options.checkout);
        const script = join(checkout, "apps/desktop/scripts/restart-local.mjs");
        await access(script);
        await new Promise<void>((ok, fail) => {
          const child = spawn(
            "node",
            [
              "--import",
              "tsx",
              script,
              "start",
              ...(options.now ? ["--now"] : []),
            ],
            { cwd: checkout, stdio: "inherit" },
          );
          child.once("error", fail);
          child.once("exit", (code) =>
            code === 0
              ? ok()
              : fail(new Error(`Restart coordinator exited ${code}`)),
          );
        });
      }),
    );
  restart
    .command("status")
    .option("--json", "Print JSON")
    .action(
      action(async (options: { json?: boolean }) => {
        const status = await createCliBbSdk(getUrl()).system.localRestart();
        console.log(
          options.json
            ? JSON.stringify(status, null, 2)
            : (status.job?.message ??
                status.job?.phase ??
                "No restart pending"),
        );
      }),
    );
  for (const command of ["cancel", "now"] as const)
    restart
      .command(command)
      .option("--json", "Print JSON")
      .description(
        command === "now"
          ? "Explicitly restart once the verified build is ready, interrupting running threads"
          : "Cancel the pending restart",
      )
      .action(
        action(async () => {
          const sdk = createCliBbSdk(getUrl());
          const status = await sdk.system.localRestart();
          if (!status.job) throw new Error("No restart pending");
          console.log(
            JSON.stringify(
              await sdk.system.controlLocalRestart({
                action: command,
                id: status.job.id,
              }),
              null,
              2,
            ),
          );
        }),
      );
}
