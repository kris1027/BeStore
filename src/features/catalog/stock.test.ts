import { describe, expect, it } from "vitest";

import { formatDelta, movedRows, stockChanges } from "./stock";

// spec 0009, AC-10 and AC-11.

describe("stockChanges", () => {
  it("skips rows left at the shown count, dropping their note", () => {
    expect(
      stockChanges([
        { variantId: "b", expected: 3, next: 3, note: "ignored" },
        { variantId: "a", expected: 3, next: 5, note: "  Counted the shelf " },
      ]),
    ).toEqual([{ variantId: "a", expected: 3, next: 5, note: "Counted the shelf" }]);
  });

  it("stores an empty note as none and sorts by variant id", () => {
    expect(
      stockChanges([
        { variantId: "c", expected: 1, next: 0, note: "" },
        { variantId: "a", expected: 0, next: 2, note: "   " },
      ]).map((change) => [change.variantId, change.note]),
    ).toEqual([
      ["a", null],
      ["c", null],
    ]);
  });
});

describe("movedRows", () => {
  const change = { variantId: "a", expected: 3, next: 5, note: null };

  it("is empty when every row still holds the count the page showed", () => {
    expect(movedRows([change], [{ id: "a", stockQuantity: 3, archived: false }])).toEqual([]);
  });

  it("reports the current count of a row a sale moved", () => {
    expect(movedRows([change], [{ id: "a", stockQuantity: 2, archived: false }])).toEqual([
      { variantId: "a", now: 2, archived: false },
    ]);
  });

  it("reports a row archived meanwhile, even at the same count", () => {
    expect(movedRows([change], [{ id: "a", stockQuantity: 3, archived: true }])).toEqual([
      { variantId: "a", now: 3, archived: true },
    ]);
  });

  it("reports a row whose variant is gone", () => {
    expect(movedRows([change], [])).toEqual([{ variantId: "a", now: null, archived: true }]);
  });
});

describe("formatDelta", () => {
  it("signs the change", () => {
    expect(formatDelta(5)).toBe("+5");
    expect(formatDelta(-2)).toBe("-2");
    expect(formatDelta(0)).toBe("0");
  });
});
