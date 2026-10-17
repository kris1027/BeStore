import { describe, expect, it } from "vitest";

import { summarizeCard, summarizeVariants } from "./product-summary";

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
describe("summarizeCard", () => {
  it("finds the price range and is on sale when an in stock variant has a compare at price", () => {
    expect(
      summarizeCard([
        { priceCents: 2500, compareAtPriceCents: null, inStock: false },
        { priceCents: 1900, compareAtPriceCents: 3000, inStock: true },
      ]),
    ).toEqual({ minPriceCents: 1900, maxPriceCents: 2500, soldOut: false, onSale: true });
  });

  it("ignores a compare at price on a sold out variant", () => {
    expect(
      summarizeCard([
        { priceCents: 1000, compareAtPriceCents: 3000, inStock: false },
        { priceCents: 1000, compareAtPriceCents: null, inStock: true },
      ]).onSale,
    ).toBe(false);
  });

  it("is sold out only when no variant is in stock, and at 0 with none", () => {
    expect(
      summarizeCard([{ priceCents: 1000, compareAtPriceCents: 3000, inStock: false }]),
    ).toMatchObject({ soldOut: true, onSale: false });
    expect(summarizeCard([])).toEqual({
      minPriceCents: 0,
      maxPriceCents: 0,
      soldOut: true,
      onSale: false,
    });
  });
});
