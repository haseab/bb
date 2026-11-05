import type { BbPluginApi } from "@get-bb/plugin-sdk";

export function openThreadListDatabase(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE backlog_threads (threadId TEXT PRIMARY KEY, sectionId TEXT NOT NULL, enteredAt INTEGER NOT NULL, followUpAt INTEGER, refreshAt INTEGER NOT NULL, refreshedAt INTEGER, stage TEXT NOT NULL CHECK (stage IN ('backlog','refreshing','refreshed')))`,
    `CREATE INDEX backlog_threads_due ON backlog_threads(stage, refreshAt)`,
    `CREATE TABLE quick_decisions (threadId TEXT PRIMARY KEY, requestKey TEXT NOT NULL, interactionId TEXT, level TEXT NOT NULL CHECK (level IN ('normal','quick','instant')), reason TEXT NOT NULL, classifiedAt INTEGER NOT NULL)`,
  ]);
  return db;
}
