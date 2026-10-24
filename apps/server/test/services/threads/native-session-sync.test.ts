import { turnScope } from "@bb/domain";
import { nativeSessionSnapshotSchema } from "@bb/provider-bridge-protocol";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { events, getThread, nativeSessionLinks, threads } from "@bb/db";
import type { NativeSessionSnapshot } from "@bb/provider-bridge-protocol";
import {
  syncNativeSession,
  isNativeSessionActive,
} from "../../../src/services/threads/native-session-sync.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadIdentity,
} from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

function snapshot(hostId: string): NativeSessionSnapshot {
  return {
    hostId,
    providerId: "codex",
    providerThreadId: "native-codex-id",
    cwd: "/tmp/native-project",
    title: "A Codex conversation",
    createdAt: 1000,
    updatedAt: 2000,
    active: false,
    turns: [
      {
        id: "native-turn",
        createdAt: 1500,
        completedAt: 1800,
        userMessages: [
          {
            id: "native-user",
            content: [
              { type: "text", text: "Investigate synchronization" },
              { type: "image", url: "data:image/png;base64,AA==" },
            ],
          },
        ],
        deltas: [
          { kind: "turn.open", providerTurnId: "native-turn" },
          {
            kind: "item.close",
            key: { providerItemId: "answer" },
            providerTurnId: "native-turn",
            item: { type: "agentMessage", text: "Initial answer" },
            status: "completed",
          },
          {
            kind: "turn.boundary",
            providerTurnId: "native-turn",
            providerCheckpointId: "native-turn",
            status: "completed",
          },
        ],
      },
    ],
  };
}

describe("native Codex conversation synchronization", () => {
  it("discovers a native session once, preserves input and images, and revises messages in place", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-project",
      });
      const input = snapshot(host.id);
      const first = syncNativeSession(harness.deps, input);
      expect(first.status).toBe("synced");
      const threadId = first.threadId!;
      expect(getThread(harness.db, threadId)?.createdAt).toBe(1000);
      const timeline = await (
        await harness.app.request(`/api/v1/threads/${threadId}/timeline`)
      ).json();
      expect(JSON.stringify(timeline)).toContain("Investigate synchronization");
      const before = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, threadId))
        .all();
      expect(
        before.filter((event) => event.type === "turn/started"),
      ).toHaveLength(1);
      const user = before.find((event) => event.itemKind === "userMessage");
      expect(JSON.parse(user!.data).item.content).toHaveLength(2);
      const notify = vi.spyOn(harness.hub, "notifyThread");
      expect(syncNativeSession(harness.deps, input).threadId).toBe(threadId);
      expect(notify).not.toHaveBeenCalled();
      input.turns[0]!.deltas[1] = {
        kind: "item.close",
        key: { providerItemId: "answer" },
        providerTurnId: "native-turn",
        item: { type: "agentMessage", text: "Updated from Codex" },
        status: "completed",
      };
      syncNativeSession(harness.deps, input);
      const after = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, threadId))
        .all();
      expect(after).toHaveLength(before.length);
      expect(
        after.find((event) => event.itemKind === "agentMessage")?.sequence,
      ).toBe(
        before.find((event) => event.itemKind === "agentMessage")?.sequence,
      );
      expect(
        after.find((event) => event.itemKind === "agentMessage")?.data,
      ).toContain("Updated from Codex");
      expect(harness.db.select().from(nativeSessionLinks).all()).toHaveLength(
        1,
      );
      notify.mockRestore();
    });
  });

  it("finds BB-owned sessions and skips turns BB has already recorded", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/native-project",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadIdentity(harness.deps, {
        threadId: thread.id,
        providerThreadId: "native-codex-id",
        environmentId: environment.id,
      });
      const input = snapshot(host.id);
      expect(syncNativeSession(harness.deps, input).threadId).toBe(thread.id);
      const count = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, thread.id))
        .all().length;
      harness.db.delete(nativeSessionLinks).run();
      expect(syncNativeSession(harness.deps, input).threadId).toBe(thread.id);
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(count);
      expect(harness.db.select().from(threads).all()).toHaveLength(1);
    });
  });

  it("defers BB-owned active threads and does not resurrect archived or deleted conversations", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-project",
      });
      const input = snapshot(host.id);
      const first = syncNativeSession(harness.deps, input);
      const id = first.threadId!;
      harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, id))
        .run();
      expect(syncNativeSession(harness.deps, input).status).toBe("busy");
      harness.db
        .update(threads)
        .set({ status: "idle", archivedAt: 3000 })
        .where(eq(threads.id, id))
        .run();
      expect(syncNativeSession(harness.deps, input).status).toBe("hidden");
      harness.db
        .update(threads)
        .set({ archivedAt: null, deletedAt: 3000 })
        .where(eq(threads.id, id))
        .run();
      expect(syncNativeSession(harness.deps, input).status).toBe("hidden");
    });
  });

  it("refreshes active turns without duplicating partial text and completes them after Codex finishes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-project",
      });
      const input = snapshot(host.id);
      input.active = true;
      input.turns[0]!.deltas.pop();
      const first = syncNativeSession(harness.deps, input);
      expect(isNativeSessionActive(harness.db, first.threadId!)).toBe(true);
      expect(
        harness.db
          .select()
          .from(events)
          .where(
            and(
              eq(events.threadId, first.threadId!),
              eq(events.type, "turn/completed"),
            ),
          )
          .all(),
      ).toHaveLength(0);
      const final = snapshot(host.id);
      syncNativeSession(harness.deps, final);
      expect(isNativeSessionActive(harness.db, first.threadId!)).toBe(false);
      expect(
        harness.db
          .select()
          .from(events)
          .where(
            and(
              eq(events.threadId, first.threadId!),
              eq(events.type, "turn/completed"),
            ),
          )
          .all(),
      ).toHaveLength(1);
    });
  });

  it("ignores unmatched directories and rolls back incomplete native snapshots atomically", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const input = snapshot(host.id);
      expect(syncNativeSession(harness.deps, input)).toEqual({
        threadId: null,
        status: "unmapped",
      });
      seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-project",
      });
      input.turns[0]!.deltas = [];
      expect(() => syncNativeSession(harness.deps, input)).toThrow(
        "did not open",
      );
      expect(harness.db.select().from(threads).all()).toHaveLength(0);
      expect(harness.db.select().from(nativeSessionLinks).all()).toHaveLength(
        0,
      );
    });
  });
  it("preserves BB-recorded checkpoints and ignores old sessions after context is cleared", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/native-project",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadIdentity(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "native-codex-id",
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "native-codex-id",
        sequence: 2,
        type: "turn/started",
        scope: turnScope("bb-turn"),
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "native-codex-id",
        sequence: 3,
        type: "turn/completed",
        scope: turnScope("bb-turn"),
        data: { status: "completed", providerCheckpointId: "native-turn" },
      });
      const original = snapshot(host.id);
      syncNativeSession(harness.deps, original);
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(3);
      seedThreadIdentity(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "new-codex-id",
      });
      expect(syncNativeSession(harness.deps, original).status).toBe("hidden");
      const replacement = nativeSessionSnapshotSchema.parse(
        JSON.parse(
          JSON.stringify(original)
            .replaceAll("native-codex-id", "new-codex-id")
            .replaceAll("native-turn", "new-native-turn"),
        ),
      );
      expect(syncNativeSession(harness.deps, replacement).threadId).toBe(
        thread.id,
      );
      expect(harness.db.select().from(threads).all()).toHaveLength(1);
      expect(harness.db.select().from(nativeSessionLinks).all()).toHaveLength(
        1,
      );
    });
  });

  it("keeps distinct unknown native items across snapshot revisions", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/native-project",
      });
      const input = snapshot(host.id);
      for (const id of ["unknown-a", "unknown-b"])
        input.turns[0]!.deltas.splice(1, 0, {
          kind: "unhandled",
          raw: {
            jsonrpc: "2.0",
            method: "item/completed",
            params: { item: { id, type: "futureCodexItem" } },
          },
          rawType: "item/completed",
          providerTurnId: "native-turn",
          vouchedTurn: true,
        });
      const first = syncNativeSession(harness.deps, input);
      expect(
        harness.db
          .select()
          .from(events)
          .where(
            and(
              eq(events.threadId, first.threadId!),
              eq(events.type, "provider/unhandled"),
            ),
          )
          .all(),
      ).toHaveLength(2);
      input.turns[0]!.userMessages[0]!.content = [
        { type: "text", text: "Updated prompt" },
      ];
      expect(() => syncNativeSession(harness.deps, input)).not.toThrow();
      expect(
        harness.db
          .select()
          .from(events)
          .where(
            and(
              eq(events.threadId, first.threadId!),
              eq(events.type, "provider/unhandled"),
            ),
          )
          .all(),
      ).toHaveLength(2);
    });
  });
});
