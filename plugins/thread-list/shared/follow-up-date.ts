import { casual } from "chrono-node";

function localParts(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const value = (name: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === name)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function offsetMinutes(at: number, timeZone: string): number {
  const p = localParts(at, timeZone);
  return (
    (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
      Math.floor(at / 1000) * 1000) /
    60_000
  );
}

export function parseFollowUpDate(
  input: string,
  now: number,
  timeZone: string,
): number | null {
  const query = input.trim();
  if (!query || query.length > 256) return null;
  try {
    const offset = offsetMinutes(now, timeZone);
    const short = query.match(
      /^(?:in\s+)?(\d+)\s*(s|sec(?:ond)?s?|m|min(?:ute)?s?|h|hr?s?|hours?|d|days?|w|wks?|weeks?|mo|months?|y|yrs?|years?)\.?$/i,
    );
    if (short) {
      const amount = Number(short[1]);
      if (!Number.isSafeInteger(amount) || amount <= 0) return null;
      const unit = short[2].toLowerCase();
      const duration = unit.startsWith("s")
        ? 1000
        : unit === "m" || unit.startsWith("min")
          ? 60_000
          : unit.startsWith("h")
            ? 3_600_000
            : null;
      if (duration !== null) {
        const at = now + amount * duration;
        return Number.isSafeInteger(at) && at <= 8_640_000_000_000_000
          ? at
          : null;
      }
    }
    const normalized = short
      ? `in ${short[1]} ${short[2].toLowerCase().startsWith("d") ? "days" : short[2].toLowerCase().startsWith("w") ? "weeks" : short[2].toLowerCase().startsWith("mo") ? "months" : "years"}`
      : query;
    const result = casual.parse(
      normalized,
      { instant: new Date(now), timezone: offset },
      { forwardDate: true },
    );
    if (result.length !== 1) return null;
    const parsed = result[0];
    if (
      normalized.slice(0, parsed.index).trim() ||
      normalized.slice(parsed.index + parsed.text.length).trim()
    )
      return null;
    const start = parsed.start;
    const relative = short !== null;
    const local = localParts(now, timeZone);
    const hour = start.isCertain("hour")
      ? (start.get("hour") ?? 9)
      : relative
        ? local.hour
        : 9;
    const minute = start.isCertain("minute")
      ? (start.get("minute") ?? 0)
      : relative
        ? local.minute
        : 0;
    const second = relative ? local.second : 0;
    const year = start.get("year");
    const month = start.get("month");
    const day = start.get("day");
    if (year === null || month === null || day === null) return null;
    const wall = Date.UTC(year, month - 1, day, hour, minute, second);
    let at = wall - offsetMinutes(now, timeZone) * 60_000;
    for (let pass = 0; pass < 3; pass++)
      at = wall - offsetMinutes(at, timeZone) * 60_000;
    const actual = localParts(at, timeZone);
    if (
      actual.hour !== hour ||
      actual.minute !== minute ||
      actual.day !== start.get("day")
    )
      return null;
    return Number.isFinite(at) && at > now ? at : null;
  } catch {
    return null;
  }
}

export function formatFollowUpDate(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(at));
}
