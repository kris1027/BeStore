import { describe, expect, it } from "vitest";

import {
  addDays,
  calendarDate,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  parseCalendarDay,
  storeToday,
  utcToZonedInput,
  zonedDateTimeToUtc,
  zonedDayStart,
} from "./dates";

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

// spec 0017, AC-1: a version date is the same day in every zone.
describe("formatCalendarDate", () => {
  it("formats a YYYY-MM-DD as a long date with no day shift", () => {
    expect(formatCalendarDate(calendarDate("2026-10-20"), "en")).toBe("October 20, 2026");
    expect(formatCalendarDate(calendarDate("2026-01-01"), "pl-PL")).toBe("1 stycznia 2026");
  });

  it("reads a Postgres date at UTC midnight as that day", () => {
    expect(formatCalendarDate(new Date("2026-03-31T00:00:00.000Z"), "en")).toBe("March 31, 2026");
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

// spec 0014, AC-11: the promo code dates, typed in the store's time zone.
describe("zonedDateTimeToUtc and utcToZonedInput", () => {
  it("reads wall clock time in the zone, on both sides of a clock change", () => {
    expect(zonedDateTimeToUtc("2026-07-01T09:30", "Europe/Warsaw")?.toISOString()).toBe(
      "2026-07-01T07:30:00.000Z",
    );
    expect(zonedDateTimeToUtc("2026-12-01T09:30", "Europe/Warsaw")?.toISOString()).toBe(
      "2026-12-01T08:30:00.000Z",
    );
    // Just after the spring change (02:00 becomes 03:00 on 29 March 2026).
    expect(zonedDateTimeToUtc("2026-03-29T03:30", "Europe/Warsaw")?.toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });

  it("refuses anything that is not a real moment", () => {
    for (const text of ["", "2026-02-30T10:00", "2026-01-01T24:00", "2026-01-01 10:00", "soon"]) {
      expect(zonedDateTimeToUtc(text, "Europe/Warsaw")).toBeNull();
    }
  });

  it("turns an instant back into the field's value, to the minute", () => {
    expect(utcToZonedInput(new Date("2026-07-01T07:30:59Z"), "Europe/Warsaw")).toBe(
      "2026-07-01T09:30",
    );
    expect(utcToZonedInput(new Date("2026-12-31T23:30:00Z"), "Europe/Warsaw")).toBe(
      "2027-01-01T00:30",
    );
    const text = "2026-10-25T12:05";
    expect(utcToZonedInput(zonedDateTimeToUtc(text, "America/New_York")!, "America/New_York")).toBe(
      text,
    );
  });
});

describe("storeToday", () => {
  it("is the store's day, not UTC's", () => {
    // 22:30 UTC on 31 March is 00:30 on 1 April in Warsaw (summer time, UTC+2).
    const moment = new Date("2026-03-31T22:30:00Z");
    expect(storeToday(moment, "Europe/Warsaw")).toEqual({ y: 2026, m: 4, d: 1 });
    expect(storeToday(moment, "UTC")).toEqual({ y: 2026, m: 3, d: 31 });
  });

  it("is still yesterday west of UTC", () => {
    expect(storeToday(new Date("2026-01-01T03:00:00Z"), "America/New_York")).toEqual({
      y: 2025,
      m: 12,
      d: 31,
    });
  });
});

describe("addDays", () => {
  it("rolls over a month, a year and a leap day", () => {
    expect(addDays({ y: 2026, m: 1, d: 31 }, 1)).toEqual({ y: 2026, m: 2, d: 1 });
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
    expect(addDays({ y: 2028, m: 2, d: 28 }, 1)).toEqual({ y: 2028, m: 2, d: 29 });
    expect(addDays({ y: 2026, m: 3, d: 1 }, -1)).toEqual({ y: 2026, m: 2, d: 28 });
  });
});
