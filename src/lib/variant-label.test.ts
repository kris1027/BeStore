import { describe, expect, it } from "vitest";

import { variantLabel } from "./variant-label";

describe("variantLabel", () => {
  it("orders the values by option type position", () => {
    expect(
      variantLabel([
        { value: "Navy", typePosition: 1 },
        { value: "M", typePosition: 0 },
      ]),
    ).toBe("M / Navy");
  });

  it("is null for a default variant", () => {
    expect(variantLabel([])).toBeNull();
  });
});
