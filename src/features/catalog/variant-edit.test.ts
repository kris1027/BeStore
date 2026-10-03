import { describe, expect, it } from "vitest";

import {
  editedRows,
  liveVariantCountAfter,
  newValueCombinations,
  renameVerdict,
  sameCombinations,
  variantsStale,
  withNewValue,
} from "./variant-edit";

// spec 0009, AC-7 to AC-9 and AC-21.

const fields = { price: 1000, compareAt: null, sku: "A", archived: false };

describe("editedRows", () => {
  it("keeps only rows the admin changed", () => {
    const same = { variantId: "a", loaded: fields, ...fields };
    const priced = { variantId: "b", loaded: fields, ...fields, price: 1200 };
    const archived = { variantId: "c", loaded: fields, ...fields, archived: true };

    expect(editedRows([same, priced, archived]).map((row) => row.variantId)).toEqual(["b", "c"]);
  });
});

describe("variantsStale", () => {
  const edit = { variantId: "a", loaded: fields, ...fields, price: 1500 };

  it("is false while the stored row still matches what was loaded", () => {
    expect(variantsStale([edit], new Map([["a", fields]]))).toBe(false);
  });

  it("is true when another save changed the row, or the row is gone", () => {
    expect(variantsStale([edit], new Map([["a", { ...fields, sku: "B" }]]))).toBe(true);
    expect(variantsStale([edit], new Map())).toBe(true);
  });
});

describe("liveVariantCountAfter", () => {
  it("counts the variants left to sell once the archive flags land", () => {
    const current = new Map([
      ["a", fields],
      ["b", { ...fields, archived: true }],
    ]);
    const archiveA = { variantId: "a", loaded: fields, ...fields, archived: true };
    const restoreB = {
      variantId: "b",
      loaded: { ...fields, archived: true },
      ...fields,
      archived: false,
    };

    expect(liveVariantCountAfter(current, [archiveA])).toBe(0);
    expect(liveVariantCountAfter(current, [archiveA, restoreB])).toBe(1);
  });
});

describe("renameVerdict", () => {
  const current = new Map([
    ["s", "S"],
    ["m", "M"],
  ]);

  it("accepts a rename to a free name, and a case change of its own name", () => {
    expect(renameVerdict([{ id: "s", loaded: "S", next: "Small" }], current)).toBe("ok");
    expect(renameVerdict([{ id: "s", loaded: "S", next: "s" }], current)).toBe("ok");
    expect(renameVerdict([{ id: "m", loaded: "M", next: "M" }], current)).toBe("ok");
  });

  it("refuses a swap, or a name another entry holds", () => {
    expect(
      renameVerdict(
        [
          { id: "s", loaded: "S", next: "M" },
          { id: "m", loaded: "M", next: "S" },
        ],
        current,
      ),
    ).toBe("swap");
    expect(renameVerdict([{ id: "s", loaded: "S", next: "m" }], current)).toBe("swap");
  });

  it("is stale when the stored name moved since the page loaded", () => {
    expect(renameVerdict([{ id: "s", loaded: "Small", next: "Tiny" }], current)).toBe("stale");
  });
});

describe("newValueCombinations", () => {
  const types = [
    ["s", "m"],
    ["red", "blue"],
  ];

  it("pairs the new value with every value of the other types, in grid order", () => {
    expect(newValueCombinations(types, 1)).toEqual([["s"], ["m"]]);
    expect(newValueCombinations(types, 0)).toEqual([["red"], ["blue"]]);
  });

  it("needs one row with no other values when the type is the only one", () => {
    expect(newValueCombinations([["s"]], 0)).toEqual([[]]);
  });

  it("places the new value at its type's index", () => {
    expect(withNewValue(["s"], 1, "oat")).toEqual(["s", "oat"]);
    expect(withNewValue(["red"], 0, "l")).toEqual(["l", "red"]);
    expect(withNewValue([], 0, "x")).toEqual(["x"]);
  });
});

describe("sameCombinations", () => {
  const needed = [["s"], ["m"]];

  it("accepts exactly the needed rows in any order", () => {
    expect(sameCombinations([["m"], ["s"]], needed)).toBe(true);
  });

  it("refuses a missing, extra, unknown or repeated row", () => {
    expect(sameCombinations([["s"]], needed)).toBe(false);
    expect(sameCombinations([["s"], ["m"], ["l"]], needed)).toBe(false);
    expect(sameCombinations([["s"], ["l"]], needed)).toBe(false);
    expect(sameCombinations([["s"], ["s"]], needed)).toBe(false);
  });
});
