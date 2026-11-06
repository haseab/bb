import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { createConnection, migrate } from "../src/index.js";

const folder = join(dirname(fileURLToPath(import.meta.url)), "../drizzle");
const legacy = [
  { tag: "0147_tiny_zaladane", when: 1792881357146 },
  { tag: "0148_great_reaper", when: 1792906525818 },
  { tag: "0149_curvy_shatterstar", when: 1792919398157 },
];

function originalFork(count: number) {
  const db = createConnection(":memory:");
  const sqlite = db.$client;
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC);
    CREATE TEMP TABLE bb_migration_existing_installation (existing INTEGER NOT NULL);
    INSERT INTO bb_migration_existing_installation VALUES (0);
    CREATE TEMP TABLE bb_migration_local_host (id TEXT PRIMARY KEY);
    CREATE TEMP TABLE bb_migration_queued_message_groups (id TEXT PRIMARY KEY, group_with_next INTEGER NOT NULL);
  `);
  for (const migration of readMigrationFiles({
    migrationsFolder: folder,
  }).slice(0, 147)) {
    for (const sql of migration.sql) sqlite.exec(sql);
    sqlite
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      )
      .run(migration.hash, migration.folderMillis);
  }
  for (const migration of legacy.slice(0, count)) {
    const sql = readFileSync(
      join(folder, "legacy-fork", `${migration.tag}.sql`),
      "utf8",
    );
    sqlite.exec(sql.split("--> statement-breakpoint").join("\n"));
    sqlite
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
      )
      .run(createHash("sha256").update(sql).digest("hex"), migration.when);
  }
  sqlite.exec(`
    INSERT INTO projects (id, name, created_at, updated_at) VALUES ('project', 'Preserve me', 1, 1);
    INSERT INTO hosts (id, name, type, created_at, updated_at) VALUES ('host', 'My machine', 'local', 1, 1);
    INSERT INTO threads (id, project_id, provider_id, title, latest_attention_at, created_at, updated_at)
      VALUES ('thread', 'project', 'codex', 'My conversation', 1, 1, 1);
    INSERT INTO native_session_links (host_id, provider_id, provider_thread_id, thread_id, active, updated_at)
      VALUES ('host', 'codex', 'native-session', 'thread', 1, 1);
    INSERT INTO native_session_turns (thread_id, provider_turn_id, hash) VALUES ('thread', 'turn', 'preserved');
  `);
  return db;
}

describe("upstream integration preserves fork databases", () => {
  it.each([1, 2, 3])(
    "upgrades an installation with %i legacy fork migrations without losing conversations or native links",
    (count) => {
      const db = originalFork(count);
      try {
        migrate(db);
        expect(
          db.$client
            .prepare(
              "SELECT title, creation_source FROM threads WHERE id = 'thread'",
            )
            .get(),
        ).toEqual({ title: "My conversation", creation_source: "bb" });
        expect(
          db.$client
            .prepare(
              "SELECT provider_thread_id FROM native_session_links WHERE thread_id = 'thread'",
            )
            .get(),
        ).toEqual({ provider_thread_id: "native-session" });
        expect(
          db.$client
            .prepare(
              "SELECT hash FROM native_session_turns WHERE thread_id = 'thread'",
            )
            .get(),
        ).toEqual({ hash: "preserved" });
        expect(db.$client.prepare("PRAGMA foreign_key_check").all()).toEqual(
          [],
        );
        db.$client.exec(`
        INSERT INTO project_sources (id, project_id, type, host_id, path, created_at, updated_at)
          VALUES ('one', 'project', 'local_path', 'host', '/one', 1, 1), ('two', 'project', 'local_path', 'host', '/two', 1, 1);
      `);
        expect(
          db.$client
            .prepare(
              "SELECT count(*) AS count FROM project_sources WHERE project_id = 'project'",
            )
            .get(),
        ).toEqual({ count: 2 });
        expect(() => migrate(db)).not.toThrow();
      } finally {
        db.$client.close();
      }
    },
  );
  it("rejects a legacy migration with an altered hash before changing the database", () => {
    const db = originalFork(3);
    try {
      db.$client
        .prepare(
          "UPDATE __drizzle_migrations SET hash = 'invalid' WHERE created_at = ?",
        )
        .run(legacy[0].when);
      expect(() => migrate(db)).toThrow("Legacy fork migration hash mismatch");
      expect(
        db.$client
          .prepare("SELECT title FROM threads WHERE id = 'thread'")
          .get(),
      ).toEqual({ title: "My conversation" });
    } finally {
      db.$client.close();
    }
  });
});
