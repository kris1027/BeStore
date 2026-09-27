import { describe, expect, it } from "vitest";

import { minimumChargeCents } from "./minimum-charge";

// spec 0006, AC-2: Stripe's published minimums.

describe("minimumChargeCents", () => {
  it.each([
    ["EUR", 50],
    ["USD", 50],
    ["GBP", 30],
    ["PLN", 200],
    ["JPY", 50],
    ["eur", 50],
  ])("is %s %i", (currency, cents) => {
    expect(minimumChargeCents(currency)).toBe(cents);
  });

  it("uses 50 for a currency not in the table", () => {
    expect(minimumChargeCents("XYZ")).toBe(50);
  });
});
