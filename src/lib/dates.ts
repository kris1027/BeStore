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

export type CalendarDay = { readonly y: number; readonly m: number; readonly d: number };

// The calendar day an instant falls on in a time zone (spec 0015, AC-2), so "today" is the
// store's day, not the server's.
export function storeToday(now: Date, timeZone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
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

// Wall clock fields (written as if UTC) read in a time zone, to their UTC instant. Safe across
// daylight saving: the offset is read again at the result itself, so a time just after a clock
// change, such as the first midnight after it, lands right.
function wallToUtc(wall: number, timeZone: string): Date {
  const guess = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(guess, timeZone));
}

// The calendar day n days later (or earlier); Date.UTC rolls months and years over.
export function addDays(day: CalendarDay, n: number): CalendarDay {
  const date = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

// The UTC instant a calendar day starts in a time zone.
export function zonedDayStart(day: CalendarDay, timeZone: string): Date {
  return wallToUtc(Date.UTC(day.y, day.m - 1, day.d), timeZone);
}

// A `datetime-local` value ("2026-10-17T14:30") read as wall clock time in a time zone, to its
// UTC instant (spec 0014, AC-11), or null when it is not a real moment.
export function zonedDateTimeToUtc(text: string, timeZone: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;
  const day = parseCalendarDay(match[1] ?? "");
  const [hour, minute, second] = [Number(match[2]), Number(match[3]), Number(match[4] ?? 0)];
  if (day === null || hour > 23 || minute > 59 || second > 59) return null;
  return wallToUtc(Date.UTC(day.y, day.m - 1, day.d, hour, minute, second), timeZone);
}

// The inverse, for a `datetime-local` field's value: the instant as wall clock time in the zone,
// to the minute.
export function utcToZonedInput(date: Date, timeZone: string): string {
  const local = new Date(date.getTime() + zoneOffsetMs(date.getTime(), timeZone));
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
  );
}
