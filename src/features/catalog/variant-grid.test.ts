import { describe, expect, it } from "vitest";

import {
  combinationCount,
  combinationKey,
  combinations,
  optionKey,
  SKU_PATTERN,
  suggestSku,
} from "./variant-grid";

describe("combinations", () => {
  it("gives one default combination with no option types", () => {
    expect(combinations([])).toEqual([[]]);
    expect(combinationCount([])).toBe(1);
  });

  it("orders by option type, then by value", () => {
    const grid = combinations([
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Red", "Blue", "Green"] },
    ]);

    expect(grid).toEqual([
      ["S", "Red"],
      ["S", "Blue"],
      ["S", "Green"],
      ["M", "Red"],
      ["M", "Blue"],
      ["M", "Green"],
    ]);
  });

  it("counts without building the grid", () => {
    const types = [
      { name: "A", values: ["1", "2", "3", "4", "5"] },
      { name: "B", values: ["1", "2", "3", "4", "5"] },
      { name: "C", values: ["1", "2", "3", "4", "5"] },
    ];
    expect(combinationCount(types)).toBe(125);
  });
});

describe("combinationKey", () => {
  it("stays the same for a row when another value is added", () => {
    const before = combinations([{ name: "Size", values: ["S", "M"] }]).map(combinationKey);
    const after = combinations([{ name: "Size", values: ["S", "M", "L"] }]).map(combinationKey);

    expect(after.slice(0, 2)).toEqual(before);
  });
});

describe("optionKey", () => {
  it("sorts the ids ascending and joins them with commas", () => {
    expect(optionKey(["b", "c", "a"])).toBe("a,b,c");
  });

  it("is empty for the default variant", () => {
    expect(optionKey([])).toBe("");
  });
});

describe("suggestSku", () => {
  it.each([
    ["linen-shirt", [], "LINEN-SHIRT"],
    ["linen-shirt", ["M", "Navy blue"], "LINEN-SHIRT-M-NAVY-BLUE"],
    ["tee", ["Écru", "XL / tall"], "TEE-ECRU-XL-TALL"],
  ])("suggests a SKU for %s %j", (slug, values, sku) => {
    expect(suggestSku(slug, values)).toBe(sku);
    expect(sku).toMatch(SKU_PATTERN);
  });

  it("stays within 64 characters", () => {
    expect(suggestSku("a".repeat(80), ["b"]).length).toBeLessThanOrEqual(64);
  });
});
