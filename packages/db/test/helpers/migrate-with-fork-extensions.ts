import {
  migrate as applyMigrations,
  type DbConnection,
} from "../../src/index.js";

export function migrate(
  db: DbConnection,
  options: Parameters<typeof applyMigrations>[1] = {},
): void {
  const sqlite = db.$client;
  const tables = sqlite
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )
    .all();
  if (
    tables.some(({ name }) => name === "native_session_links") &&
    tables.some(({ name }) => name === "__drizzle_migrations")
  ) {
    const columns = sqlite
      .prepare<[], { name: string }>("PRAGMA table_info(threads)")
      .all();
    const journal = sqlite
      .prepare<[], { hash: string; created_at: number }>(
        "SELECT hash, created_at FROM __drizzle_migrations",
      )
      .all();
    const latest = Math.max(...journal.map(({ created_at }) => created_at));
    if (
      latest <= 1793861269499 &&
      columns.some(({ name }) => name === "creation_source")
    ) {
      const foreignKeys = sqlite.pragma("foreign_keys", { simple: true });
      sqlite.pragma("foreign_keys = OFF");
      sqlite.exec(
        "DROP TABLE native_session_turns; DROP TABLE native_session_links; ALTER TABLE threads DROP COLUMN creation_source; DROP INDEX project_sources_project_host_path_idx; CREATE UNIQUE INDEX project_sources_project_host_idx ON project_sources(project_id, host_id);",
      );
      if (foreignKeys) sqlite.pragma("foreign_keys = ON");
    }
  }
  applyMigrations(db, options);
}
