import { describe, expect, it } from "vitest";
import { parseFollowUpDate } from "./follow-up-date.js";

const now = Date.parse("2026-11-04T20:00:00Z");
const zone = "America/Los_Angeles";
describe("follow-up date parsing", () => {
  it.each(["7d", "7 days", "in 7 days"])(
    "parses %s as seven days ahead",
    (input) => {
      expect(parseFollowUpDate(input, now, zone)).toBe(
        Date.parse("2026-11-11T20:00:00Z"),
      );
    },
  );
  it.each(["61 min", "61m", "in 61 minutes"])(
    "parses %s with minute precision",
    (input) => {
      expect(parseFollowUpDate(input, now, zone)).toBe(now + 61 * 60_000);
    },
  );
  it("uses the next September 1 at 9am locally", () => {
    expect(parseFollowUpDate("sep 1", now, zone)).toBe(
      Date.parse("2027-09-01T16:00:00Z"),
    );
  });
  it("handles explicit time and a different timezone", () => {
    expect(parseFollowUpDate("tomorrow at 3pm", now, "Asia/Tokyo")).toBe(
      Date.parse("2026-11-06T06:00:00Z"),
    );
  });
  it("keeps the local clock time across daylight saving changes", () => {
    expect(
      parseFollowUpDate("7d", Date.parse("2026-10-30T19:00:00Z"), zone),
    ).toBe(Date.parse("2026-11-06T20:00:00Z"));
  });
  it.each([
    "",
    "nonsense",
    "yesterday",
    "0m",
    "-3 days",
    "7d garbage",
    "99999999999999999m",
  ])("rejects invalid or past input %s", (input) => {
    expect(parseFollowUpDate(input, now, zone)).toBeNull();
  });
  it("rejects an invalid timezone", () => {
    expect(parseFollowUpDate("61 min", now, "Invalid/Zone")).toBeNull();
  });
});
