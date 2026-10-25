import { and, eq, inArray } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { nativeSessionLinks } from "../schema.js";
import { queryInSqliteVariableBatches } from "./sqlite-variable-batches.js";

export function listActiveNativeSessionThreadIds(
  db: DbConnection,
  threadIds: readonly string[],
): string[] {
  return queryInSqliteVariableBatches({
    values: threadIds,
    dedupeKey: (id) => id,
    fixedVariableCount: 1,
    variableCountPerValue: 1,
    queryBatch: (ids) =>
      db
        .select({ threadId: nativeSessionLinks.threadId })
        .from(nativeSessionLinks)
        .where(
          and(
            eq(nativeSessionLinks.active, true),
            inArray(nativeSessionLinks.threadId, [...ids]),
          ),
        )
        .all()
        .map((row) => row.threadId),
  });
}
