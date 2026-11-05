import { describe, expect, it } from "vitest";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import { userMessageRows } from "@bb/thread-view";

describe("conversation peek", () => {
  it("keeps human inputs in order including nested turns and excludes assistant, agent, and system messages", () => {
    const first = conversationRow({
      id: "first",
      role: "user",
      text: "My question",
    });
    const second = conversationRow({
      id: "second",
      role: "user",
      text: "Follow up",
    });
    expect(
      userMessageRows([
        first,
        conversationRow({ role: "assistant", text: "Response" }),
        conversationRow({
          role: "user",
          initiator: "agent",
          text: "Agent message",
        }),
        conversationRow({
          role: "user",
          initiator: "system",
          text: "System message",
        }),
        turnRow({
          children: [second, conversationRow({ text: "Nested response" })],
        }),
      ]),
    ).toEqual([first, second]);
    expect(userMessageRows([first])[0]).toBe(first);
  });
});
