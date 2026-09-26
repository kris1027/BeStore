import { describe, expect, it } from "vitest";

import { availability, lineCap, quantityLimit } from "./availability";

describe("availability", () => {
  it.each([
    [0, { kind: "sold_out" }],
    [-1, { kind: "sold_out" }],
    [1, { kind: "low", left: 1 }],
    [5, { kind: "low", left: 5 }],
    [6, { kind: "in_stock" }],
    [999_999, { kind: "in_stock" }],
  ])("stock %i is %j", (stock, expected) => {
    expect(availability(stock)).toEqual(expected);
  });
});

describe("lineCap", () => {
  it.each([
    [0, 0],
    [-3, 0],
    [3, 3],
    [10, 10],
    [11, 10],
    [500, 10],
  ])("stock %i caps a line at %i", (stock, cap) => {
    expect(lineCap(stock)).toBe(cap);
  });
});

describe("quantityLimit", () => {
  it("offers what is left at low stock, and 10 above it without revealing the count", () => {
    expect(quantityLimit(availability(0))).toBe(0);
    expect(quantityLimit(availability(3))).toBe(3);
    expect(quantityLimit(availability(7))).toBe(10);
    expect(quantityLimit(availability(500))).toBe(10);
  });
});
