import { openThreadListDatabase } from "../storage.js";
import {
  type BbPluginApi,
  cliCommand,
  PluginCliError,
} from "@get-bb/plugin-sdk";
import type { createPreferenceStore } from "../server.js";
import {
  BACKLOG_CHANGED_CHANNEL,
  backlogItemSchema,
  type BacklogItem,
  type BacklogState,
} from "../shared/backlog.js";
import { parseFollowUpDate } from "../shared/follow-up-date.js";

const DAY = 86_400_000;
const PAGE_SIZE = 200;

export function createBacklogPolicy(
  bb: BbPluginApi,
  preferences: ReturnType<typeof createPreferenceStore>,
) {
  const db = openThreadListDatabase(bb);
  let sectionId: string | null = null;
  const rows = () =>
    backlogItemSchema
      .array()
      .parse(
        db
          .prepare("SELECT * FROM backlog_threads ORDER BY enteredAt, threadId")
          .all(),
      );
  const get = (id: string) => {
    const value = db
      .prepare("SELECT * FROM backlog_threads WHERE threadId = ?")
      .get(id);
    return value === undefined ? null : backlogItemSchema.parse(value);
  };
  const put = (item: BacklogItem) =>
    db
      .prepare(
        `INSERT INTO backlog_threads (threadId, sectionId, enteredAt, followUpAt, refreshAt, refreshedAt, stage) VALUES (@threadId, @sectionId, @enteredAt, @followUpAt, @refreshAt, @refreshedAt, @stage) ON CONFLICT(threadId) DO UPDATE SET sectionId=excluded.sectionId, enteredAt=excluded.enteredAt, followUpAt=excluded.followUpAt, refreshAt=excluded.refreshAt, refreshedAt=excluded.refreshedAt, stage=excluded.stage`,
      )
      .run(item);
  const remove = (id: string) =>
    db.prepare("DELETE FROM backlog_threads WHERE threadId = ?").run(id);
  const snapshot = (): BacklogState => ({ sectionId, items: rows() });
  const publish = () =>
    bb.realtime.publish(BACKLOG_CHANGED_CHANNEL, snapshot());

  async function destination() {
    const sections = await bb.sdk.threadSections.list();
    const saved = await preferences.read("backlogSectionId");
    const section =
      sections.find((candidate) => candidate.id === saved) ??
      (saved === null
        ? sections.find(
            (candidate) => candidate.name.toLowerCase() === "backlog",
          )
        : undefined);
    sectionId = section?.id ?? null;
    if (section && saved !== section.id)
      await preferences.write("backlogSectionId", section.id);
    return section;
  }

  async function appendRefreshed(id: string) {
    const order = await preferences.read("manualThreadOrder");
    await preferences.write("manualThreadOrder", [
      ...order.filter((candidate) => candidate !== id),
      id,
    ]);
  }

  async function reconcile() {
    const before = JSON.stringify(snapshot());
    const section = await destination();
    const now = Date.now();
    const days = await preferences.read("backlogRefreshDays");
    if (section) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const threads = await bb.sdk.threads.list({
          sectionId: section.id,
          hasParent: false,
          includeHidden: true,
          limit: PAGE_SIZE,
          offset,
        });
        for (const thread of threads) {
          if (
            thread.pinnedAt !== null ||
            thread.archivedAt !== null ||
            thread.parentThreadId !== null
          )
            continue;
          const item = get(thread.id);
          if (
            !item ||
            item.sectionId !== section.id ||
            item.stage === "refreshed"
          ) {
            put({
              threadId: thread.id,
              sectionId: section.id,
              enteredAt: now,
              followUpAt: null,
              refreshAt: now + days * DAY,
              refreshedAt: null,
              stage: "backlog",
            });
          }
        }
        if (threads.length < PAGE_SIZE) break;
      }
    }
    const tracked = rows();
    const current = new Map<
      string,
      Awaited<ReturnType<typeof bb.sdk.threads.list>>[number]
    >();
    for (let offset = 0; offset < tracked.length; offset += PAGE_SIZE) {
      for (const thread of await bb.sdk.threads.list({
        threadIds: tracked
          .slice(offset, offset + PAGE_SIZE)
          .map((item) => item.threadId),
        includeHidden: true,
        limit: PAGE_SIZE,
      }))
        current.set(thread.id, thread);
    }
    for (const item of tracked) {
      const thread = current.get(item.threadId);
      if (
        !thread ||
        thread.archivedAt !== null ||
        thread.pinnedAt !== null ||
        thread.parentThreadId !== null
      ) {
        remove(item.threadId);
        continue;
      }
      if (item.stage === "refreshed") {
        if (
          thread.sectionId !== null ||
          thread.status === "active" ||
          thread.status === "starting"
        )
          remove(thread.id);
        continue;
      }
      if (!section || item.sectionId !== section.id) {
        remove(item.threadId);
        continue;
      }
      if (
        thread.sectionId !== section.id &&
        !(item.stage === "refreshing" && thread.sectionId === null)
      ) {
        remove(thread.id);
        continue;
      }
      if (
        thread.status === "active" ||
        thread.status === "starting" ||
        item.refreshAt > now
      )
        continue;
      const fresh = await bb.sdk.threads.get({ threadId: thread.id });
      if (
        fresh.archivedAt !== null ||
        fresh.deletedAt !== null ||
        fresh.pinnedAt !== null ||
        fresh.parentThreadId !== null ||
        fresh.status === "active" ||
        fresh.status === "starting"
      )
        continue;
      if (
        fresh.sectionId !== section.id &&
        !(item.stage === "refreshing" && fresh.sectionId === null)
      ) {
        remove(thread.id);
        continue;
      }
      put({ ...item, stage: "refreshing" });
      if (fresh.sectionId !== null)
        await bb.sdk.threads.update({ threadId: thread.id, sectionId: null });
      await appendRefreshed(thread.id);
      put({ ...item, stage: "refreshed", refreshedAt: now });
    }
    if (JSON.stringify(snapshot()) !== before) publish();
    return snapshot();
  }

  async function schedule(
    threadId: string,
    input: string,
    timeZone: string,
    onlyBacklog = false,
  ) {
    const now = Date.now();
    const at = parseFollowUpDate(input, now, timeZone);
    if (at === null)
      throw new PluginCliError(
        "Enter a future date or duration, such as 7d, 61 min, or Sep 1.",
        { code: "invalid_follow_up" },
      );
    const section = await destination();
    if (!section)
      throw new Error("Create or configure a Backlog section first.");
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.archivedAt !== null || thread.deletedAt !== null)
      throw new Error("Unarchive the thread before scheduling a follow-up.");
    if (
      onlyBacklog &&
      (thread.sectionId !== section.id ||
        thread.pinnedAt !== null ||
        thread.parentThreadId !== null)
    )
      throw new Error(
        "This thread is no longer in Backlog. Skip it to continue triage.",
      );
    if (thread.pinnedAt !== null) await bb.sdk.threads.unpin({ threadId });
    if (thread.sectionId !== section.id || thread.parentThreadId !== null)
      await bb.sdk.threads.update({
        threadId,
        sectionId: section.id,
        parentThreadId: null,
      });
    const existing = get(threadId);
    put({
      threadId,
      sectionId: section.id,
      enteredAt: existing?.stage === "backlog" ? existing.enteredAt : now,
      followUpAt: at,
      refreshAt: at,
      refreshedAt: null,
      stage: "backlog",
    });
    publish();
    return snapshot();
  }

  async function clear(threadId: string) {
    const item = get(threadId);
    const thread = await bb.sdk.threads.get({ threadId });
    if (
      !item ||
      item.stage !== "backlog" ||
      thread.sectionId !== item.sectionId ||
      thread.archivedAt !== null
    )
      throw new Error("This thread is no longer in Backlog.");
    const now = Date.now();
    put({
      ...item,
      enteredAt: now,
      followUpAt: null,
      refreshAt: now + (await preferences.read("backlogRefreshDays")) * DAY,
    });
    publish();
    return snapshot();
  }

  async function markHot(threadId: string) {
    const item = get(threadId);
    if (!item || item.stage !== "refreshed") return;
    const thread = await bb.sdk.threads.get({ threadId });
    if (
      thread.sectionId === null &&
      thread.archivedAt === null &&
      thread.pinnedAt === null
    ) {
      const order = await preferences.read("manualThreadOrder");
      await preferences.write("manualThreadOrder", [
        threadId,
        ...order.filter((id) => id !== threadId),
      ]);
    }
    remove(threadId);
    publish();
  }

  return { reconcile, schedule, clear, markHot, snapshot };
}

export function backlogCommands(
  policy: ReturnType<typeof createBacklogPolicy>,
  serialize: <T>(operation: () => Promise<T>) => Promise<T>,
) {
  const json = {
    type: "boolean",
    description: "Emit machine-readable JSON",
  } as const;
  return {
    "backlog list": cliCommand({
      summary: "List Backlog follow-up dates and refreshed queue threads",
      options: { json },
      async run(input) {
        const state = await serialize(policy.reconcile);
        return {
          exitCode: 0,
          stdout: input.options.json
            ? JSON.stringify(state)
            : state.items
                .map(
                  (item) =>
                    `${item.threadId}\t${item.stage}\t${new Date(item.refreshAt).toISOString()}\t${item.followUpAt === null ? "default" : "scheduled"}`,
                )
                .join("\n"),
        };
      },
    }),
    "backlog schedule": cliCommand({
      summary: "Schedule a thread follow-up, moving it to Backlog",
      positionals: [
        { name: "thread-id", required: true, description: "Thread id" },
        {
          name: "when",
          required: true,
          description: "Future date or duration, e.g. 7d or Sep 1",
        },
      ],
      options: {
        json,
        timezone: {
          type: "string",
          description: "IANA timezone; defaults to the server's local timezone",
        },
      },
      async run(input) {
        const state = await serialize(() =>
          policy.schedule(
            input.positionals["thread-id"],
            input.positionals.when,
            String(
              input.options.timezone ??
                Intl.DateTimeFormat().resolvedOptions().timeZone,
            ),
          ),
        );
        return {
          exitCode: 0,
          stdout: input.options.json
            ? JSON.stringify(state)
            : `Scheduled ${input.positionals["thread-id"]}`,
        };
      },
    }),
    "backlog clear": cliCommand({
      summary:
        "Clear an explicit Backlog date and restart the default countdown",
      positionals: [
        { name: "thread-id", required: true, description: "Thread id" },
      ],
      options: { json },
      async run(input) {
        const state = await serialize(() =>
          policy.clear(input.positionals["thread-id"]),
        );
        return {
          exitCode: 0,
          stdout: input.options.json
            ? JSON.stringify(state)
            : `Reset follow-up for ${input.positionals["thread-id"]}`,
        };
      },
    }),
  };
}
