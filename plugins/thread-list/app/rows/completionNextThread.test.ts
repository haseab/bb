import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../model/fixtures.js";
import { completionNextThreadId } from "./completionNextThread.js";

const threads = [
  makeSidebarThread({ id: "before" }),
  makeSidebarThread({ id: "current" }),
  makeSidebarThread({ id: "child", parentThreadId: "current" }),
  makeSidebarThread({ id: "grandchild", parentThreadId: "child" }),
  makeSidebarThread({ id: "done", sectionId: "completed" }),
  makeSidebarThread({ id: "archived", archivedAt: 1 }),
  makeSidebarThread({ id: "after" }),
];

describe("next chat after completion", () => {
  it("follows sidebar order and skips the completed subtree and completed or archived rows", () => {
    expect(
      completionNextThreadId(
        "current",
        threads.map((thread) => thread.id),
        threads,
        "completed",
      ),
    ).toBe("after");
  });
  it("uses the previous remaining row at the end without opening a hidden thread", () => {
    expect(
      completionNextThreadId(
        "current",
        ["before", "current", "child"],
        threads,
        "completed",
      ),
    ).toBe("before");
  });
  it("has no next chat when only the completed subtree remains", () => {
    expect(
      completionNextThreadId(
        "current",
        ["current", "child", "grandchild"],
        threads,
        null,
      ),
    ).toBeNull();
  });
});
