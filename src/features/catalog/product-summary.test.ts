import { describe, expect, it } from "vitest";

import { isOnSale, summarizeVariants } from "./product-summary";

describe("summarizeVariants", () => {
  it("sums stock and finds the price range", () => {
    expect(
      summarizeVariants([
        { priceCents: 2500, stockQuantity: 3 },
        { priceCents: 1900, stockQuantity: 0 },
        { priceCents: 3100, stockQuantity: 7 },
      ]),
    ).toEqual({
      variantCount: 3,
      totalStock: 10,
      minPriceCents: 1900,
      maxPriceCents: 3100,
      soldOut: false,
    });
  });

  it("is sold out only when every variant has no stock", () => {
    const summary = summarizeVariants([
      { priceCents: 2500, stockQuantity: 0 },
      { priceCents: 2500, stockQuantity: 0 },
    ]);
    expect(summary.soldOut).toBe(true);
    expect(summary.minPriceCents).toBe(summary.maxPriceCents);
  });

  it("treats a product with no variants as sold out", () => {
    expect(summarizeVariants([])).toEqual({
      variantCount: 0,
      totalStock: 0,
      minPriceCents: 0,
      maxPriceCents: 0,
      soldOut: true,
    });
  });
});

// covers: spec 0009 AC-16
describe("isOnSale", () => {
  it("is true when an in stock variant has a compare at price", () => {
    expect(
      isOnSale([
        { stockQuantity: 0, compareAtPriceCents: null },
        { stockQuantity: 2, compareAtPriceCents: 3000 },
      ]),
    ).toBe(true);
  });

  it("ignores a compare at price on a sold out variant", () => {
    expect(
      isOnSale([
        { stockQuantity: 0, compareAtPriceCents: 3000 },
        { stockQuantity: 4, compareAtPriceCents: null },
      ]),
    ).toBe(false);
    expect(isOnSale([])).toBe(false);
  });
});
