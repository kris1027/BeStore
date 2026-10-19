import { z } from "zod";

import { firstValue } from "@/lib/admin-search";
import { type CalendarDay, parseCalendarDay, zonedDayStart } from "@/lib/dates";

// Pure: the dashboard's period as it lives in the URL (spec 0015, AC-2 to AC-4 and AC-11). Bad
// params never error: they fall back to the default window, with a notice for a bad range.

export const salesPresets = ["today", "7d", "30d", "month", "12m"] as const;
export type SalesPreset = (typeof salesPresets)[number];

export const defaultPreset: SalesPreset = "30d";

export const presetLabels: Readonly<Record<SalesPreset, string>> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  "12m": "Last 12 months",
};

// A custom range of at most this many store days (AC-3), a leap year.
export const MAX_RANGE_DAYS = 366;

export type BucketUnit = "day" | "week" | "month";

// Whole store days, first and last inclusive (YYYY-MM-DD), as the URL and the page show them.
export type StoreDays = {
  readonly firstDay: string;
  readonly lastDay: string;
};

// The same days with the UTC instants they span: from the start of the first day to the start
// of the day after the last, half open.
export type DayRange = StoreDays & {
  readonly start: Date;
  readonly end: Date;
};

// A chart bucket: keyed by its real first day (a Monday or the 1st, even before the window
// starts, the same key SQL's date_trunc gives), labelled from its first day inside the window.
export type SalesBucket = {
  readonly key: string;
  readonly firstDay: string;
};

export type SalesWindow = {
  // null for a custom range.
  readonly preset: SalesPreset | null;
  // A from/to pair that could not be used, so the default window is shown with a notice.
  readonly rejectedRange: boolean;
  readonly dayCount: number;
  readonly current: DayRange;
  // Same number of store days, ending the day before the current window starts (AC-4).
  readonly previous: DayRange;
  readonly unit: BucketUnit;
  readonly buckets: readonly SalesBucket[];
};

const MS_PER_DAY = 86_400_000;

// Days as whole numbers since 1970-01-01 (UTC calendar arithmetic, no time zone involved), so
// adding days is plain addition and Date.UTC handles month and year overflow.
function dayNumber(day: CalendarDay): number {
  return Date.UTC(day.y, day.m - 1, day.d) / MS_PER_DAY;
}

function fromDayNumber(n: number): CalendarDay {
  const date = new Date(n * MS_PER_DAY);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

export function dayText(day: CalendarDay): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${day.y}-${pad(day.m)}-${pad(day.d)}`;
}

function dayRange(first: number, last: number, timeZone: string): DayRange {
  return {
    firstDay: dayText(fromDayNumber(first)),
    lastDay: dayText(fromDayNumber(last)),
    start: zonedDayStart(fromDayNumber(first), timeZone),
    end: zonedDayStart(fromDayNumber(last + 1), timeZone),
  };
}

function presetFirstDay(preset: SalesPreset, today: CalendarDay): number {
  const todayNumber = dayNumber(today);
  switch (preset) {
    case "today":
      return todayNumber;
    case "7d":
      return todayNumber - 6;
    case "30d":
      return todayNumber - 29;
    case "month":
      return dayNumber({ y: today.y, m: today.m, d: 1 });
    case "12m":
      // Date.UTC rolls a month below 1 back into the previous year.
      return Date.UTC(today.y, today.m - 1 - 11, 1) / MS_PER_DAY;
  }
}

function bucketUnit(preset: SalesPreset | null, dayCount: number): BucketUnit {
  if (preset === "12m") return "month";
  if (dayCount <= 31) return "day";
  if (dayCount <= 182) return "week";
  return "month";
}

function bucketKey(n: number, unit: BucketUnit): number {
  if (unit === "day") return n;
  if (unit === "week") {
    // getUTCDay is 0 on Sunday; weeks start on Monday, as date_trunc('week') does.
    const sinceMonday = (new Date(n * MS_PER_DAY).getUTCDay() + 6) % 7;
    return n - sinceMonday;
  }
  const day = fromDayNumber(n);
  return dayNumber({ y: day.y, m: day.m, d: 1 });
}

// Every bucket of the window, in order, empty ones included (AC-11).
export function windowBuckets(first: number, last: number, unit: BucketUnit): SalesBucket[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
    .filter((n) => n === first || bucketKey(n, unit) !== bucketKey(n - 1, unit))
    .map((n) => ({
      key: dayText(fromDayNumber(bucketKey(n, unit))),
      firstDay: dayText(fromDayNumber(n)),
    }));
}

function salesWindow(
  preset: SalesPreset | null,
  first: number,
  last: number,
  rejectedRange: boolean,
  timeZone: string,
): SalesWindow {
  const dayCount = last - first + 1;
  const unit = bucketUnit(preset, dayCount);
  return {
    preset,
    rejectedRange,
    dayCount,
    current: dayRange(first, last, timeZone),
    previous: dayRange(first - dayCount, first - 1, timeZone),
    unit,
    buckets: windowBuckets(first, last, unit),
  };
}

const presetSchema = z.enum(salesPresets).optional().catch(undefined);

// The picker's hidden `shown` field on a page showing a custom range.
export const shownCustom = "custom";

// An empty field (the picker's date inputs left blank) counts as missing.
function textParam(value: unknown): string | null {
  const first = firstValue(value);
  return typeof first === "string" && first !== "" ? first : null;
}

// The custom range's first and last day numbers, or null when it cannot be used (AC-3).
function customRange(from: string | null, to: string | null, today: number) {
  if (from === null || to === null) return null;
  const fromDay = parseCalendarDay(from);
  const toDay = parseCalendarDay(to);
  if (fromDay === null || toDay === null) return null;
  const first = dayNumber(fromDay);
  // A future end is clamped to today; a future start is refused.
  const last = Math.min(dayNumber(toDay), today);
  if (first > today || first > last || last - first + 1 > MAX_RANGE_DAYS) return null;
  return { first, last };
}

export function parseSalesWindow(
  params: Readonly<Record<string, unknown>>,
  today: CalendarDay,
  timeZone: string,
): SalesWindow {
  const todayNumber = dayNumber(today);
  const picked = presetSchema.parse(firstValue(params.period));
  const presetWindow = (preset: SalesPreset, rejectedRange: boolean) =>
    salesWindow(preset, presetFirstDay(preset, today), todayNumber, rejectedRange, timeZone);
  // Without JavaScript the picker cannot clear its date inputs, so from a custom range a preset
  // picked in the select arrives with the old dates. The form marks that page with
  // shown=custom, and then the preset wins (AC-3).
  if (picked !== undefined && firstValue(params.shown) === shownCustom) {
    return presetWindow(picked, false);
  }
  const from = textParam(params.from);
  const to = textParam(params.to);
  if (from !== null || to !== null) {
    const range = customRange(from, to, todayNumber);
    if (range !== null) return salesWindow(null, range.first, range.last, false, timeZone);
    return presetWindow(defaultPreset, true);
  }
  return presetWindow(picked ?? defaultPreset, false);
}

function utcDate(text: string): Date {
  return new Date(`${text}T00:00:00Z`);
}

// "Oct 18" for a day, "Week of Oct 15" for a week (from its first day inside the window), and
// "Oct 2026" for a month, clipped or not (AC-11).
export function bucketLabel(bucket: SalesBucket, unit: BucketUnit, locale: string): string {
  if (unit === "month") {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(utcDate(bucket.key));
  }
  const day = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(utcDate(bucket.firstDay));
  return unit === "week" ? `Week of ${day}` : day;
}

// A store day (YYYY-MM-DD) as the page shows it, e.g. "Oct 18, 2026".
export function formatStoreDay(text: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    utcDate(text),
  );
}
