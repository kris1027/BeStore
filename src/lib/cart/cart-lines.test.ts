import { describe, expect, it } from "vitest";

import { canCheckout, cartQuantity, cartSubtotal, type LineFacts, lineFlag } from "./cart-lines";

const line = (overrides: Partial<LineFacts> = {}): LineFacts => ({
  quantity: 2,
  priceCents: 1999,
  stockQuantity: 10,
  variantArchived: false,
  productActive: true,
  ...overrides,
});

// covers: spec 0005 AC-11
describe("lineFlag", () => {
  it("passes a line within stock", () => {
    expect(lineFlag(line())).toEqual({ kind: "ok" });
    expect(lineFlag(line({ quantity: 10 }))).toEqual({ kind: "ok" });
  });

  it("flags an archived variant or a product that is not active as unavailable", () => {
    expect(lineFlag(line({ variantArchived: true }))).toEqual({ kind: "unavailable" });
    expect(lineFlag(line({ productActive: false }))).toEqual({ kind: "unavailable" });
  });

  it("flags a variant with no stock as sold out", () => {
    expect(lineFlag(line({ stockQuantity: 0 }))).toEqual({ kind: "sold_out" });
  });

  it("flags a quantity above stock with what is left", () => {
    expect(lineFlag(line({ quantity: 5, stockQuantity: 3 }))).toEqual({
      kind: "insufficient",
      left: 3,
    });
  });

  it("shows only the first flag that applies", () => {
    expect(lineFlag(line({ variantArchived: true, stockQuantity: 0 }))).toEqual({
      kind: "unavailable",
    });
    expect(lineFlag(line({ quantity: 5, stockQuantity: 0 }))).toEqual({ kind: "sold_out" });
  });
});

describe("cart totals", () => {
  it("sums line totals from live prices and quantities", () => {
    const lines = [line({ quantity: 2, priceCents: 1999 }), line({ quantity: 1, priceCents: 500 })];
    expect(cartSubtotal(lines)).toBe(4498);
    expect(cartQuantity(lines)).toBe(3);
  });
});

describe("canCheckout", () => {
  it("needs at least one line", () => {
    expect(canCheckout([])).toBe(false);
  });

  it("is blocked by any flagged line", () => {
    expect(canCheckout([line(), line({ stockQuantity: 0 })])).toBe(false);
    expect(canCheckout([line(), line()])).toBe(true);
  });
});
