import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "./fixtures.js";
import { partitionCompletedThreads } from "./completedThreads.js";

describe("completed thread grouping", () => {
  it("keeps descendants with their completed root and leaves other work in its original order", () => {
    const threads = [
      makeSidebarThread({ id: "grandchild", parentThreadId: "child" }),
      makeSidebarThread({ id: "queued" }),
      makeSidebarThread({ id: "child", parentThreadId: "done" }),
      makeSidebarThread({ id: "done", sectionId: "sec_completed" }),
      makeSidebarThread({ id: "other", sectionId: "sec_other" }),
    ];
    const result = partitionCompletedThreads(threads, "sec_completed");
    expect(result.completed.map((thread) => thread.id)).toEqual([
      "grandchild",
      "child",
      "done",
    ]);
    expect(result.remaining.map((thread) => thread.id)).toEqual([
      "queued",
      "other",
    ]);
    expect(partitionCompletedThreads(threads, null).remaining).toBe(threads);
  });
});
