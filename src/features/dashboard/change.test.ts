import { describe, expect, it } from "vitest";

import { averageChange, averageOrderValue, figureChange } from "./change";

// spec 0015, AC-4 and AC-7.
describe("figureChange", () => {
  it.each([
    [120, 100, "Up 20%"],
    [80, 100, "Down 20%"],
    [100, 100, "No change"],
    // Half away from zero.
    [201, 200, "Up 1%"],
    [199, 200, "Down 1%"],
    // Rounds to 0.
    [1001, 1000, "No change"],
    [999, 1000, "No change"],
    // A negative figure now still compares with a positive previous one.
    [-50, 100, "Down 150%"],
  ])("%i against %i reads %s", (current, previous, text) => {
    expect(figureChange(current, previous, 30)).toEqual({ text, suffix: "vs previous 30 days" });
  });

  it("has nothing to compare with when the previous value is 0 or negative", () => {
    const none = { text: "No earlier figure to compare", suffix: null };
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
    ).toEqual({ text: "Up 50%", suffix: "vs previous 7 days" });
  });

  it("says there were no orders when the previous window had some", () => {
    expect(averageChange({ orders: 0, grossCents: 0 }, { orders: 3, grossCents: 900 }, 7)).toEqual({
      text: "No orders in this period",
      suffix: null,
    });
  });

  it("has nothing to compare with when either window has no orders", () => {
    const none = { text: "No earlier figure to compare", suffix: null };
    expect(averageChange({ orders: 0, grossCents: 0 }, { orders: 0, grossCents: 0 }, 7)).toEqual(
      none,
    );
    expect(averageChange({ orders: 2, grossCents: 900 }, { orders: 0, grossCents: 0 }, 7)).toEqual(
      none,
    );
  });
});
