import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime, parseCalendarDay, zonedDayStart } from "./dates";

describe("formatDate", () => {
  // 23:30 UTC on 31 March is already 1 April in Warsaw (UTC+2 in summer time).
  const lateEvening = new Date("2026-03-31T23:30:00Z");

  it("uses the store's day, not UTC's", () => {
    expect(formatDate(lateEvening, { locale: "en", timeZone: "Europe/Warsaw" })).toBe(
      "Apr 1, 2026",
    );
    expect(formatDate(lateEvening, { locale: "en", timeZone: "UTC" })).toBe("Mar 31, 2026");
  });

  it("uses the store's locale", () => {
    expect(formatDate(lateEvening, { locale: "pl-PL", timeZone: "UTC" })).toBe("31 mar 2026");
  });
});

describe("formatDateTime", () => {
  it("shows the store's local time", () => {
    const moment = new Date("2026-03-31T23:30:00Z");

    expect(formatDateTime(moment, { locale: "en", timeZone: "Europe/Warsaw" })).toBe(
      "Apr 1, 2026, 1:30 AM",
    );
  });
});

describe("parseCalendarDay", () => {
  it("accepts only real days", () => {
    expect(parseCalendarDay("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseCalendarDay("2026-02-29")).toBeNull();
    expect(parseCalendarDay("2026-2-1")).toBeNull();
  });
});

describe("zonedDayStart", () => {
  it("starts a day at the zone's midnight, on both sides of daylight saving", () => {
    expect(zonedDayStart({ y: 2026, m: 1, d: 15 }, "Europe/Warsaw").toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
    expect(zonedDayStart({ y: 2026, m: 7, d: 15 }, "Europe/Warsaw").toISOString()).toBe(
      "2026-07-14T22:00:00.000Z",
    );
    // The days the clocks change in 2026 (29 March, 25 October) still start at local midnight.
    expect(zonedDayStart({ y: 2026, m: 3, d: 29 }, "Europe/Warsaw").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(zonedDayStart({ y: 2026, m: 3, d: 30 }, "Europe/Warsaw").toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
    expect(zonedDayStart({ y: 2026, m: 10, d: 25 }, "Europe/Warsaw").toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
    expect(zonedDayStart({ y: 2026, m: 10, d: 26 }, "America/New_York").toISOString()).toBe(
      "2026-10-26T04:00:00.000Z",
    );
    expect(zonedDayStart({ y: 2026, m: 10, d: 26 }, "UTC").toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
  });
});
