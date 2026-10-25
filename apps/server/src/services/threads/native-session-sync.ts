import { createHash } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  createEnvironment,
  createThread,
  events,
  environments,
  findProjectEnvironmentByHostPath,
  getPublicProjectByLocalPathSource,
  getThread,
  getLastStoredProviderThreadId,
  nativeSessionLinks,
  nativeSessionTurns,
  noopNotifier,
  syncNativeTurnEvents,
  threads,
  updateThread,
  appendStoredThreadEventsInTransaction,
  type DbConnection,
  type DbNotifier,
} from "@bb/db";
import { threadScope, turnScope, type ThreadEvent } from "@bb/domain";
import { createDeltaAssembler } from "@bb/provider-bridge-protocol/assembler";
import {
  nativeSessionSnapshotSchema,
  type NativeSessionSnapshot,
  type NativeSessionSyncResult,
} from "@bb/provider-bridge-protocol";

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function syncNativeSession(
  deps: { db: DbConnection; hub: DbNotifier },
  input: NativeSessionSnapshot,
): NativeSessionSyncResult {
  const snapshot = nativeSessionSnapshotSchema.parse(input);
  const key = and(
    eq(nativeSessionLinks.hostId, snapshot.hostId),
    eq(nativeSessionLinks.providerId, snapshot.providerId),
    eq(nativeSessionLinks.providerThreadId, snapshot.providerThreadId),
  );
  let threadId = deps.db
    .select()
    .from(nativeSessionLinks)
    .where(key)
    .get()?.threadId;
  if (!threadId) {
    const existing = deps.db
      .select({ id: threads.id })
      .from(events)
      .innerJoin(threads, eq(events.threadId, threads.id))
      .innerJoin(environments, eq(threads.environmentId, environments.id))
      .where(
        and(
          eq(events.type, "thread/identity"),
          eq(events.providerThreadId, snapshot.providerThreadId),
          eq(threads.providerId, snapshot.providerId),
          eq(environments.hostId, snapshot.hostId),
        ),
      )
      .get();
    threadId = existing?.id;
  }
  if (threadId) {
    const thread = getThread(deps.db, threadId);
    if (
      !thread ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.visibility === "hidden"
    )
      return { threadId, status: "hidden" };
    const currentProviderThreadId = getLastStoredProviderThreadId(
      deps.db,
      threadId,
    );
    if (
      currentProviderThreadId !== null &&
      currentProviderThreadId !== snapshot.providerThreadId
    )
      return { threadId, status: "hidden" };
    if (thread.status !== "idle" && thread.status !== "error")
      return { threadId, status: "busy" };
  }
  const project = getPublicProjectByLocalPathSource(deps.db, {
    type: "local_path",
    hostId: snapshot.hostId,
    path: snapshot.cwd,
  });
  if (!threadId && !project) return { threadId: null, status: "unmapped" };
  let changed = false;
  let created = false;
  const result = deps.db.transaction(() => {
    if (!threadId && project) {
      const environment =
        findProjectEnvironmentByHostPath(
          deps.db,
          project.id,
          snapshot.hostId,
          snapshot.cwd,
        ) ??
        createEnvironment(deps.db, noopNotifier, {
          projectId: project.id,
          hostId: snapshot.hostId,
          path: snapshot.cwd,
          providerOwnsPath: false,
          status: "ready",
        });
      const thread = createThread(deps.db, noopNotifier, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: snapshot.providerId,
        creationSource: "native",
        title: snapshot.title,
        status: "idle",
      });
      threadId = thread.id;
      deps.db
        .update(threads)
        .set({ createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt })
        .where(eq(threads.id, threadId))
        .run();
      deps.db.transaction((tx) =>
        appendStoredThreadEventsInTransaction(tx, [
          {
            threadId: thread.id,
            environmentId: environment.id,
            providerThreadId: snapshot.providerThreadId,
            scope: threadScope(),
            type: "thread/identity",
            data: { providerThreadId: snapshot.providerThreadId },
          },
        ]),
      );
      created = true;
    }
    if (!threadId) throw new Error("Native session has no BB thread");
    const thread = getThread(deps.db, threadId);
    if (!thread?.environmentId)
      return { threadId, status: "unmapped" } as const;
    const environmentId = thread.environmentId;
    const previousLink = deps.db
      .select()
      .from(nativeSessionLinks)
      .where(key)
      .get();
    const sessionChanged =
      !previousLink || previousLink.active !== snapshot.active;
    deps.db
      .delete(nativeSessionLinks)
      .where(
        and(
          eq(nativeSessionLinks.threadId, threadId),
          ne(nativeSessionLinks.providerThreadId, snapshot.providerThreadId),
        ),
      )
      .run();
    deps.db
      .insert(nativeSessionLinks)
      .values({
        hostId: snapshot.hostId,
        providerId: snapshot.providerId,
        providerThreadId: snapshot.providerThreadId,
        threadId,
        active: snapshot.active,
        updatedAt: snapshot.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          nativeSessionLinks.hostId,
          nativeSessionLinks.providerId,
          nativeSessionLinks.providerThreadId,
        ],
        set: { active: snapshot.active, updatedAt: snapshot.updatedAt },
      })
      .run();
    changed ||= sessionChanged;
    const title = snapshot.title.replace(/^\[bb\]\s*/, "");
    if (title && thread.title !== title) {
      updateThread(deps.db, noopNotifier, threadId, { title });
      changed = true;
    }
    for (const turn of snapshot.turns) {
      const where = and(
        eq(nativeSessionTurns.threadId, threadId),
        eq(nativeSessionTurns.providerTurnId, turn.id),
      );
      const previous = deps.db
        .select()
        .from(nativeSessionTurns)
        .where(where)
        .get();
      const hash = digest(
        JSON.stringify([3, turn.deltas, turn.userMessages, turn.completedAt]),
      );
      if (previous?.hash === hash) continue;
      if (!previous) {
        const recorded = deps.db
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.threadId, threadId),
              eq(events.type, "turn/completed"),
              sql`json_extract(${events.data}, '$.providerCheckpointId') = ${turn.id}`,
            ),
          )
          .get();
        if (recorded) continue;
      }
      const prefix = `native-${digest(`${snapshot.hostId}:${snapshot.providerId}:${snapshot.providerThreadId}:${turn.id}`).slice(0, 24)}`;
      const assembler = createDeltaAssembler({
        providerId: snapshot.providerId,
        entropyPrefix: prefix,
      });
      const assembled = assembler.assemble({ threadId, deltas: turn.deltas });
      const turnId = assembler.getBbTurnId(threadId, turn.id);
      if (!turnId)
        throw new Error("Native turn snapshot did not open its turn");
      const userEvents: ThreadEvent[] = turn.userMessages.map((message) => ({
        type: "item/completed",
        threadId: thread.id,
        providerThreadId: snapshot.providerThreadId,
        scope: turnScope(turnId),
        item: {
          type: "userMessage",
          origin: "external",
          id: `${prefix}-user-${digest(message.id).slice(0, 16)}`,
          content: message.content,
        },
      }));
      const materialized: ThreadEvent[] = assembled
        .filter(
          (event) =>
            event.type === "turn/started" ||
            event.type === "turn/completed" ||
            event.type === "item/completed" ||
            event.type === "provider/unhandled",
        )
        .map((event) => {
          const stamped = {
            ...event,
            threadId: thread.id,
            providerThreadId: snapshot.providerThreadId,
          };
          if ("item" in stamped) {
            const providerItemId = assembler.getProviderItemId(
              thread.id,
              stamped.item.id,
            );
            if (providerItemId)
              return {
                ...stamped,
                item: {
                  ...stamped.item,
                  id: `${prefix}-item-${digest(providerItemId).slice(0, 16)}`,
                },
              };
          }
          return stamped;
        });
      materialized.splice(1, 0, ...userEvents);
      deps.db.transaction((tx) => {
        changed =
          syncNativeTurnEvents(tx, {
            threadId: thread.id,
            environmentId,
            providerThreadId: snapshot.providerThreadId,
            turnId,
            createdAt: turn.createdAt,
            completedAt: turn.completedAt,
            snapshot: materialized,
          }) || changed;
        tx.insert(nativeSessionTurns)
          .values({ threadId: thread.id, providerTurnId: turn.id, hash })
          .onConflictDoUpdate({
            target: [
              nativeSessionTurns.threadId,
              nativeSessionTurns.providerTurnId,
            ],
            set: { hash },
          })
          .run();
      });
    }
    if (changed && !created)
      deps.db
        .update(threads)
        .set({ updatedAt: Date.now(), latestAttentionAt: Date.now() })
        .where(eq(threads.id, threadId))
        .run();
    return { threadId, status: "synced" } as const;
  });
  if (changed || created) {
    deps.hub.notifyThread(result.threadId, [
      "title-changed",
      "history-compacted",
      "events-appended",
      "status-changed",
    ]);
  }
  return result;
}

export function isNativeSessionActive(
  db: DbConnection,
  threadId: string,
): boolean {
  return (
    db
      .select({ active: nativeSessionLinks.active })
      .from(nativeSessionLinks)
      .where(eq(nativeSessionLinks.threadId, threadId))
      .get()?.active ?? false
  );
}
