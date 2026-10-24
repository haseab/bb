import type { z } from "zod";
import { cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  codexSessionHostContract,
  codexSessionSyncContract,
} from "./session-sync-contract.js";

function wait(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export function registerCodexSessionSync(
  bb: BbPluginApi,
  enabled: () => Promise<boolean>,
): void {
  const host = bb.hosts.experimental_client({
    contract: codexSessionHostContract,
  });
  const versions = new Map<
    string,
    { fingerprint: string; checkedAt: number; active: boolean }
  >();
  let serviceSignal: AbortSignal | undefined;
  const retryAfter = new Map<string, number>();
  let pending: Promise<{
    synced: number;
    busy: number;
    errors: number;
  }> | null = null;
  const sync = () => {
    if (pending) return pending;
    pending = (async () => {
      const result = { synced: 0, busy: 0, errors: 0 };
      if (!(await enabled())) return result;
      const [hosts, projects] = await Promise.all([
        bb.sdk.hosts.list(),
        bb.sdk.projects.list(),
      ]);
      for (const machine of hosts) {
        if (
          machine.status === "disconnected" ||
          (retryAfter.get(machine.id) ?? 0) > Date.now()
        )
          continue;
        const providers = await bb.sdk.providers.list({
          hostId: machine.id,
          signal: serviceSignal,
        });
        if (!providers.some((provider) => provider.id === "codex")) continue;
        const sources = projects.flatMap((project) =>
          project.sources.filter(
            (source) =>
              source.type === "local_path" && source.hostId === machine.id,
          ),
        );
        const cwd = sources.flatMap((source) =>
          source.type === "local_path" ? [source.path] : [],
        );
        if (cwd.length === 0) continue;
        try {
          let cursor: string | null = null;
          do {
            const page: z.infer<
              (typeof codexSessionHostContract)["sessions.list"]["output"]
            > = await host.call(
              "sessions.list",
              { cwd, cursor },
              { hostId: machine.id, timeoutMs: 30_000, signal: serviceSignal },
            );
            for (const metadata of page.data) {
              const key = `${machine.id}:${metadata.id}`;
              const fingerprint = JSON.stringify([
                metadata.updatedAt,
                metadata.name,
                metadata.preview,
              ]);
              const previous = versions.get(key);
              if (
                previous?.fingerprint === fingerprint &&
                !previous.active &&
                Date.now() - previous.checkedAt < 30_000
              )
                continue;
              try {
                let historyCursor: string | null = null;
                let synced = true;
                let active = false;
                do {
                  const history: z.infer<
                    (typeof codexSessionHostContract)["sessions.read"]["output"]
                  > = await host.call(
                    "sessions.read",
                    { threadId: metadata.id, cursor: historyCursor },
                    {
                      hostId: machine.id,
                      timeoutMs: 30_000,
                      signal: serviceSignal,
                    },
                  );
                  if (serviceSignal?.aborted) return result;
                  active = history.session.active;
                  const applied =
                    await bb.providers.internal_DO_NOT_USE_syncNativeSession({
                      ...history.session,
                      hostId: machine.id,
                    });
                  if (applied.status === "busy") {
                    synced = false;
                    result.busy += 1;
                    break;
                  }
                  historyCursor = history.nextCursor;
                } while (historyCursor !== null);
                if (synced) {
                  versions.set(key, {
                    fingerprint,
                    active,
                    checkedAt: Date.now(),
                  });
                  result.synced += 1;
                }
              } catch (error) {
                result.errors += 1;
                versions.delete(key);
                bb.log.warn(
                  `Codex conversation ${metadata.id} could not be refreshed: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }
            cursor = page.nextCursor;
          } while (cursor !== null);
        } catch (error) {
          result.errors += 1;
          retryAfter.set(machine.id, Date.now() + 30_000);
          for (const key of versions.keys())
            if (key.startsWith(`${machine.id}:`)) versions.delete(key);
          bb.log.warn(
            `Codex conversations on ${machine.name} could not be listed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return result;
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
  const refresh = async () => {
    if (pending) await pending;
    versions.clear();
    retryAfter.clear();
    return sync();
  };
  bb.rpc.register(codexSessionSyncContract, { "sessions.sync": refresh });
  bb.cli.register(
    defineCli({
      name: "codex-sync",
      summary: "Refresh live Codex conversations in bb",
      usageErrorExitCode: 2,
      commands: {
        sync: cliCommand({
          summary: "Discover conversations and refresh their history",
          options: { json: { type: "boolean", description: "Print JSON" } },
          async run(input) {
            const result = await refresh();
            return {
              exitCode: result.errors > 0 ? 1 : 0,
              stdout: input.options.json
                ? `${JSON.stringify(result)}\n`
                : `Refreshed ${result.synced} Codex conversations; ${result.busy} running in bb; ${result.errors} errors.\n`,
            };
          },
        }),
      },
    }),
  );
  bb.background.service("conversation-sync", {
    async start(signal) {
      serviceSignal = signal;
      const unsubscribe = bb.sdk.subscribe({
        event: "host:changed",
        callback: () => versions.clear(),
      });
      try {
        while (!signal.aborted) {
          try {
            await sync();
          } catch (error) {
            bb.log.warn(
              `Codex conversation sync failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          await wait(signal, 2_000);
        }
      } finally {
        unsubscribe();
        versions.clear();
      }
    },
  });
}
