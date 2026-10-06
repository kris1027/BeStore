export type DateFormat = {
  readonly locale: string;
  readonly timeZone: string;
};

// Timestamps are stored in UTC and shown in the store's timezone (AGENTS.md), so a date near
// midnight lands on the store's day, not the server's.
export function formatDate(date: Date, { locale, timeZone }: DateFormat): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(date);
}

// A moment to the minute, for audit trails such as an order's history.
export function formatDateTime(date: Date, { locale, timeZone }: DateFormat): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

// A calendar day typed as YYYY-MM-DD, only when it is a real day (no 2026-02-30).
export function parseCalendarDay(text: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? { y, m, d }
    : null;
}

// How far the zone is ahead of UTC at this instant, in milliseconds.
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - (instant - (instant % 1000));
}

// The UTC instant a calendar day starts in a time zone, safe across daylight saving: the offset
// is read at the result itself, so a day after a clock change starts at its own midnight.
export function zonedDayStart(
  day: { readonly y: number; readonly m: number; readonly d: number },
  timeZone: string,
): Date {
  const wall = Date.UTC(day.y, day.m - 1, day.d);
  let instant = wall - zoneOffsetMs(wall, timeZone);
  instant = wall - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}
