import { describe, expect, it } from "vitest";

import { discountCodeTextSchema, normalizeEmail, parseCodeText } from "./schema";

// spec 0014, AC-1, AC-3 and AC-11.

describe("parseCodeText", () => {
  it("trims and uppercases what the customer typed", () => {
    expect(parseCodeText("  summer-10 ")).toBe("SUMMER-10");
  });

  it("is safe to run twice", () => {
    const once = discountCodeTextSchema.parse(" welcome5 ");
    expect(discountCodeTextSchema.parse(once)).toBe(once);
  });

  it("refuses anything outside 3 to 32 letters, digits or hyphens", () => {
    for (const text of ["ab", "A".repeat(33), "SUMMER 10", "ZNIŻKA", "10%", "", 42, null]) {
      expect(parseCodeText(text)).toBeNull();
    }
    expect(parseCodeText("abc")).toBe("ABC");
    expect(parseCodeText("A".repeat(32))).toBe("A".repeat(32));
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, and is safe to run twice", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(normalizeEmail(normalizeEmail(" B@x.io"))).toBe("b@x.io");
  });
});
