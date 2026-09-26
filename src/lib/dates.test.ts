import { describe, expect, it } from "vitest";

import { formatDate } from "./dates";

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
