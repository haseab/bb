import type { TimelineRow } from "@bb/server-contract";

export function userMessageRows(rows: TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) => {
    if (row.kind === "turn") return userMessageRows(row.children ?? []);
    return row.kind === "conversation" &&
      row.role === "user" &&
      row.initiator === "user" &&
      row.systemMessageKind === "unlabeled"
      ? [row]
      : [];
  });
}
