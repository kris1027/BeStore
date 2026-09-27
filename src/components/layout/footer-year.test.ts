import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { STORE_TIMEZONE: "UTC" } }));

const { storeYear } = await import("./footer-year");

// 11:00 UTC on New Year's Eve is already 01:00 on 1 January in Kiritimati (UTC+14).
const newYearsEve = new Date("2026-12-31T11:00:00Z");

describe("storeYear", () => {
  it("uses the store's year, not UTC's, when the store is ahead", () => {
    expect(storeYear(newYearsEve, "Pacific/Kiritimati")).toBe("2027");
  });

  it("uses the UTC year for a UTC store at the same instant", () => {
    expect(storeYear(newYearsEve, "UTC")).toBe("2026");
  });

  it("uses the store's year when the store is behind UTC", () => {
    expect(storeYear(new Date("2027-01-01T05:00:00Z"), "Pacific/Pago_Pago")).toBe("2026");
  });
});
