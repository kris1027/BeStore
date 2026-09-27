import { describe, expect, it } from "vitest";

import { availability } from "@/lib/availability";

import { initialVariant, isValueAvailable, variantFor, withValue } from "./picker";

// Size S, M × Color Red, Blue; M/Blue does not exist.
const variants = [
  { id: "s-red", availability: availability(0), optionValueIds: ["s", "red"] },
  { id: "s-blue", availability: availability(3), optionValueIds: ["s", "blue"] },
  { id: "m-red", availability: availability(0), optionValueIds: ["m", "red"] },
];

describe("initialVariant", () => {
  it("picks the first in stock variant by position", () => {
    expect(initialVariant(variants)?.id).toBe("s-blue");
  });

  it("falls back to the first variant when all are sold out", () => {
    const soldOut = variants.map((v) => ({ ...v, availability: availability(0) }));
    expect(initialVariant(soldOut)?.id).toBe("s-red");
  });
});

describe("variantFor", () => {
  it("finds the variant for a full selection", () => {
    expect(variantFor(variants, ["m", "red"])?.id).toBe("m-red");
  });

  it("finds nothing for a missing combination", () => {
    expect(variantFor(variants, ["m", "blue"])).toBeUndefined();
  });

  it("finds the default variant with an empty selection", () => {
    const single = [{ id: "only", availability: availability(9), optionValueIds: [] }];
    expect(variantFor(single, [])?.id).toBe("only");
  });
});

describe("isValueAvailable", () => {
  it("disables a value whose combinations are all missing or sold out", () => {
    expect(isValueAvailable(variants, 0, "m")).toBe(false);
    expect(isValueAvailable(variants, 1, "red")).toBe(false);
  });

  it("keeps a value with at least one in stock combination", () => {
    expect(isValueAvailable(variants, 0, "s")).toBe(true);
    expect(isValueAvailable(variants, 1, "blue")).toBe(true);
  });
});

describe("withValue", () => {
  it("replaces only the value of that option type", () => {
    expect(withValue(["s", "red"], 1, "blue")).toEqual(["s", "blue"]);
  });
});
