import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMigratedConnection } from "../src/testing.js";
import {
  createProject,
  createThread,
  noopNotifier,
  upsertHost,
} from "../src/index.js";
import { events, nativeSessionLinks, threads } from "../src/schema.js";

it("backfills native imports while preserving BB sessions that also sync", () => {
  const db = createMigratedConnection();
  try {
    const host = upsertHost(db, noopNotifier, { name: "host" });
    const { project } = createProject(db, noopNotifier, { name: "project" });
    const imported = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const syncedBb = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const pendingBb = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    for (const thread of [imported, syncedBb]) {
      db.insert(nativeSessionLinks)
        .values({
          hostId: host.id,
          providerId: "codex",
          providerThreadId: thread.id,
          threadId: thread.id,
          active: false,
          updatedAt: 1,
        })
        .run();
      db.insert(events)
        .values({
          id: thread.id,
          threadId: thread.id,
          scopeKind: "thread",
          type:
            thread === imported ? "thread/identity" : "client/turn/requested",
          sequence: 1,
          createdAt: 1,
        })
        .run();
    }
    db.$client.exec("ALTER TABLE threads DROP COLUMN creation_source");
    const sql = readFileSync(
      new URL("../drizzle/0149_curvy_shatterstar.sql", import.meta.url),
      "utf8",
    );
    for (const statement of sql.split("--> statement-breakpoint"))
      db.$client.exec(statement);
    expect(
      db
        .select({ id: threads.id, source: threads.creationSource })
        .from(threads)
        .all(),
    ).toEqual([
      { id: imported.id, source: "native" },
      { id: syncedBb.id, source: "bb" },
      { id: pendingBb.id, source: "bb" },
    ]);
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  } finally {
    db.$client.close();
  }
});
