import { describe, expect, it } from "vitest";

import { SLUG_MAX_LENGTH, SLUG_PATTERN, slugField, slugify } from "./slug";

describe("slugify", () => {
  it.each([
    ["Linen Shirt", "linen-shirt"],
    ["  Crème Brûlée & Co.  ", "creme-brulee-co"],
    // "ł" has no NFKD base letter, so it becomes a hyphen like any other symbol.
    ["Zażółć gęślą", "zazo-c-gesla"],
    ["T-Shirt -- 100% cotton", "t-shirt-100-cotton"],
    ["!!!", ""],
  ])("turns %j into %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("stays within the length limit without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(79)} b`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).toMatch(SLUG_PATTERN);
  });
});

describe("SLUG_PATTERN", () => {
  it.each(["a", "linen-shirt", "t-shirt-2"])("accepts %s", (slug) => {
    expect(slug).toMatch(SLUG_PATTERN);
  });

  it.each(["", "-a", "a-", "a--b", "A", "a_b", "__none__"])("refuses %j", (slug) => {
    expect(slug).not.toMatch(SLUG_PATTERN);
  });
});

describe("slugField", () => {
  it("trims and accepts a valid slug", () => {
    expect(slugField.parse("  linen-shirt ")).toBe("linen-shirt");
  });

  it.each([
    ["", "Enter a URL name."],
    ["a".repeat(SLUG_MAX_LENGTH + 1), `Keep it under ${SLUG_MAX_LENGTH} characters.`],
    ["Linen Shirt", "Use lowercase letters and digits, joined by single hyphens."],
  ])("refuses %j with its message", (slug, message) => {
    const result = slugField.safeParse(slug);
    expect(result.success ? undefined : result.error.issues[0]?.message).toBe(message);
  });
});
