import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../model/fixtures.js";
import {
  buildSectionThreadList,
  type ThreadComparator,
} from "../model/project-thread-groups.js";
import type { QuickDecision } from "../../shared/decisions.js";
import { currentDecision, decisionComparator } from "./model.js";

const thread = (
  id: string,
  overrides: Parameters<typeof makeSidebarThread>[0] = {},
) => makeSidebarThread({ id, latestAttentionAt: 10, ...overrides });
const decision = (
  id: string,
  level: QuickDecision["level"] = "instant",
): QuickDecision => ({
  threadId: id,
  level,
  requestKey: "idle:10:request",
  interactionId: null,
  classifiedAt: 1,
  reason: "Choose a format",
});

describe("quick-decision display order", () => {
  it("promotes instant then quick, preserving saved order within every tier", () => {
    const threads = [
      thread("ordinary-a"),
      thread("quick-a"),
      thread("instant-a"),
      thread("ordinary-b"),
      thread("instant-b"),
      thread("quick-b"),
    ];
    const positions = new Map(threads.map((t, index) => [t.id, index]));
    const base: ThreadComparator = (a, b) =>
      positions.get(a.id)! - positions.get(b.id)!;
    const items = [
      decision("quick-a", "quick"),
      decision("quick-b", "quick"),
      decision("instant-a"),
      decision("instant-b"),
    ];
    const sorted = [...threads].sort(decisionComparator(base, threads, items));
    expect(sorted.map((t) => t.id)).toEqual([
      "instant-a",
      "instant-b",
      "quick-a",
      "quick-b",
      "ordinary-a",
      "ordinary-b",
    ]);
    expect([...threads].sort(base).map((t) => t.id)).toEqual(
      threads.map((t) => t.id),
    );
  });
  it("keeps pinned and custom-section order, and brings a blocked child's queue parent forward", () => {
    const threads = [
      thread("ordinary"),
      thread("parent"),
      thread("child", { parentThreadId: "parent" }),
      thread("pinned", { pinnedAt: 1 }),
      thread("custom", { sectionId: "later" }),
    ];
    const positions = new Map(threads.map((t, index) => [t.id, index]));
    const base: ThreadComparator = (a, b) =>
      positions.get(a.id)! - positions.get(b.id)!;
    const compare = decisionComparator(base, threads, [
      decision("child"),
      decision("pinned"),
      decision("custom"),
    ]);
    expect(compare(threads[3], threads[0])).toBe(base(threads[3], threads[0]));
    expect(compare(threads[4], threads[0])).toBe(base(threads[4], threads[0]));
    const items = buildSectionThreadList(threads.slice(0, 3), compare);
    expect(items[0]).toMatchObject({
      kind: "thread",
      node: { thread: { id: "parent" } },
    });
  });
  it("keeps a read decision visible while ignoring errors and stale requests", () => {
    expect(
      currentDecision(thread("read", { lastReadAt: 20 }), decision("read")),
    ).not.toBeNull();
    expect(
      currentDecision(
        thread("old", { latestAttentionAt: 30 }),
        decision("old"),
      ),
    ).toBeNull();
    expect(
      currentDecision(thread("error", { status: "error" }), decision("error")),
    ).toBeNull();
    expect(
      currentDecision(
        thread("running", { status: "active" }),
        decision("running"),
      ),
    ).toBeNull();
  });
});
