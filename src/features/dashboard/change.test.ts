import { describe, expect, it } from "vitest";

import { averageChange, averageOrderValue, figureChange } from "./change";

// spec 0015, AC-4 and AC-7.
describe("figureChange", () => {
  it.each([
    [120, 100, "Up 20%", "up"],
    [80, 100, "Down 20%", "down"],
    [100, 100, "No change", "flat"],
    // Half away from zero.
    [201, 200, "Up 1%", "up"],
    [199, 200, "Down 1%", "down"],
    // Rounds to 0.
    [1001, 1000, "No change", "flat"],
    [999, 1000, "No change", "flat"],
    // A negative figure now still compares with a positive previous one.
    [-50, 100, "Down 150%", "down"],
  ])("%i against %i reads %s", (current, previous, text, trend) => {
    expect(figureChange(current, previous, 30)).toEqual({
      text,
      trend,
      suffix: "vs previous 30 days",
    });
  });

  it("has nothing to compare with when the previous value is 0 or negative", () => {
    const none = { text: "No earlier figure to compare", trend: "flat", suffix: null };
    expect(figureChange(500, 0, 30)).toEqual(none);
    expect(figureChange(500, -200, 30)).toEqual(none);
  });

  it("says one day in the singular", () => {
    expect(figureChange(2, 1, 1).suffix).toBe("vs previous 1 day");
  });
});

describe("averageOrderValue", () => {
  it("rounds half up to a whole cent", () => {
    expect(averageOrderValue(1001, 2)).toBe(501);
    expect(averageOrderValue(1000, 3)).toBe(333);
  });

  it("is null with no orders", () => {
    expect(averageOrderValue(0, 0)).toBeNull();
  });
});

describe("averageChange", () => {
  it("compares the two averages", () => {
    expect(
      averageChange({ orders: 2, grossCents: 6000 }, { orders: 1, grossCents: 2000 }, 7),
    ).toEqual({ text: "Up 50%", trend: "up", suffix: "vs previous 7 days" });
  });

  it("says there were no orders when the previous window had some", () => {
    expect(averageChange({ orders: 0, grossCents: 0 }, { orders: 3, grossCents: 900 }, 7)).toEqual({
      text: "No orders in this period",
      trend: "flat",
      suffix: null,
    });
  });

  it("has nothing to compare with when either window has no orders", () => {
    const none = { text: "No earlier figure to compare", trend: "flat", suffix: null };
    expect(averageChange({ orders: 0, grossCents: 0 }, { orders: 0, grossCents: 0 }, 7)).toEqual(
      none,
    );
    expect(averageChange({ orders: 2, grossCents: 900 }, { orders: 0, grossCents: 0 }, 7)).toEqual(
      none,
    );
  });
});
