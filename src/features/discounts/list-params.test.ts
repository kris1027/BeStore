import { describe, expect, it } from "vitest";

import { hasDiscountFilters, parseDiscountListParams } from "./list-params";

// spec 0014, AC-10: the /admin/discounts search and status filter in the URL.

describe("parseDiscountListParams", () => {
  it("reads the search and the status, and ignores a bad status", () => {
    expect(parseDiscountListParams({ q: " sum ", status: "used_up" })).toEqual({
      q: "sum",
      status: "used_up",
    });
    expect(parseDiscountListParams({ status: "gone" })).toEqual({ q: "", status: null });
    expect(parseDiscountListParams({ status: ["expired", "active"] }).status).toBe("expired");
  });

  it("says when a filter is set", () => {
    const params = parseDiscountListParams({ q: "10%", status: "active" });
    expect(hasDiscountFilters(params)).toBe(true);
    expect(hasDiscountFilters(parseDiscountListParams({}))).toBe(false);
  });
});
