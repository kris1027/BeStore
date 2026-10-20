import { describe, expect, it } from "vitest";

import { fillPlaceholders, findFillMarkers, placeholderNames, toFillMarker } from "./placeholders";

describe("fillPlaceholders", () => {
  it("fills every known name, with or without inner spaces", () => {
    expect(
      fillPlaceholders("{{seller.name}} at {{ seller.email }}", {
        "seller.name": "Shop sp. z o.o.",
        "seller.email": "hi@example.com",
      }),
    ).toBe("Shop sp. z o.o. at hi@example.com");
  });

  // spec 0017, AC-4: `{{...}}` text never ships.
  it("throws on a name with no value", () => {
    expect(() => fillPlaceholders("{{unknown}}", {})).toThrow("{{unknown}}");
  });

  it("leaves the names in keep for a later fill", () => {
    expect(fillPlaceholders("{{deliveryFee}} and {{a}}", { a: "x" }, ["deliveryFee"])).toBe(
      "{{deliveryFee}} and x",
    );
  });

  it("does not read a value inserted by an earlier fill as a placeholder", () => {
    expect(fillPlaceholders("{{a}}", { a: "{{b}}" })).toBe("{{b}}");
  });
});

describe("placeholderNames", () => {
  it("lists every name in order", () => {
    expect(placeholderNames("{{a}} x {{ b.c }} {{a}}")).toEqual(["a", "b.c", "a"]);
  });
});

describe("fill markers", () => {
  it("finds every [[TO FILL ...]] marker", () => {
    expect(findFillMarkers(`a ${toFillMarker("seller.address")} b [[TO FILL]]`)).toEqual([
      "[[TO FILL: seller.address]]",
      "[[TO FILL]]",
    ]);
  });

  it("finds none in a filled text", () => {
    expect(findFillMarkers("All filled [[link]]")).toEqual([]);
  });
});
