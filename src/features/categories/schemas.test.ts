import { describe, expect, it } from "vitest";

import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  categoryFieldErrors,
  categoryFieldsSchema,
  type CategoryFieldsInput,
  setCategoryProductsSchema,
  updateCategorySchema,
} from "./schemas";

const categoryId = "01890000-0000-7000-8000-000000000001";

function fields(overrides: Partial<CategoryFieldsInput> = {}): CategoryFieldsInput {
  return { name: "Shirts", slug: "shirts", description: "", visible: true, ...overrides };
}

function errorsOf(input: CategoryFieldsInput) {
  const result = categoryFieldsSchema.safeParse(input);
  return result.success ? {} : categoryFieldErrors(result.error);
}

// covers: spec 0009 AC-17
describe("categoryFieldsSchema", () => {
  it("trims the fields and stores an empty description as none", () => {
    expect(
      categoryFieldsSchema.parse(
        fields({ name: "  Shirts ", slug: " shirts ", description: "  " }),
      ),
    ).toEqual({ name: "Shirts", slug: "shirts", description: null, visible: true });
  });

  it("keeps a plain text description as written", () => {
    expect(
      categoryFieldsSchema.parse(fields({ description: " Linen & cotton " })).description,
    ).toBe("Linen & cotton");
  });

  it("accepts a name of 100 characters and refuses 101", () => {
    expect(errorsOf(fields({ name: "a".repeat(100) }))).toEqual({});
    expect(errorsOf(fields({ name: "a".repeat(101) }))).toEqual({
      name: "Keep it under 100 characters.",
    });
  });

  it("asks for a name and a URL name when they are blank", () => {
    expect(errorsOf(fields({ name: "   ", slug: "" }))).toEqual({
      name: "Enter a name.",
      slug: "Enter a URL name.",
    });
  });

  it.each(["Shirts", "two--hyphens", "-leading", "trailing-", "with space", "zażółć"])(
    "refuses the slug %j with the product slug rule",
    (slug) => {
      expect(errorsOf(fields({ slug }))).toEqual({
        slug: "Use lowercase letters and digits, joined by single hyphens.",
      });
    },
  );

  it("accepts a description at the cap and refuses one character more", () => {
    const atCap = "a".repeat(CATEGORY_DESCRIPTION_MAX_LENGTH);
    expect(errorsOf(fields({ description: atCap }))).toEqual({});
    expect(errorsOf(fields({ description: `${atCap}a` }))).toEqual({
      description: `Keep it under ${CATEGORY_DESCRIPTION_MAX_LENGTH} characters.`,
    });
  });
});

// covers: spec 0009 AC-21 (the update carries the version the editor loaded)
describe("updateCategorySchema", () => {
  it("reads the loaded version as a date", () => {
    const parsed = updateCategorySchema.parse({
      ...fields(),
      categoryId,
      loadedUpdatedAt: "2026-10-03T10:00:00.000Z",
    });
    expect(parsed.loadedUpdatedAt).toEqual(new Date("2026-10-03T10:00:00.000Z"));
  });

  it("refuses a malformed id or version", () => {
    const result = updateCategorySchema.safeParse({
      ...fields(),
      categoryId: "nope",
      loadedUpdatedAt: "yesterday",
    });
    expect(result.success).toBe(false);
    expect(result.success ? {} : Object.keys(categoryFieldErrors(result.error)).sort()).toEqual([
      "categoryId",
      "loadedUpdatedAt",
    ]);
  });
});

// covers: spec 0009 AC-18
describe("setCategoryProductsSchema", () => {
  const productId = "01890000-0000-7000-8000-000000000002";

  it("defaults both lists to empty", () => {
    expect(setCategoryProductsSchema.parse({ categoryId })).toEqual({
      categoryId,
      add: [],
      remove: [],
    });
  });

  it("caps each list at 100 ids", () => {
    const ids = (count: number) => Array.from({ length: count }, () => productId);
    expect(setCategoryProductsSchema.safeParse({ categoryId, add: ids(100) }).success).toBe(true);
    expect(setCategoryProductsSchema.safeParse({ categoryId, add: ids(101) }).success).toBe(false);
    expect(setCategoryProductsSchema.safeParse({ categoryId, remove: ids(101) }).success).toBe(
      false,
    );
  });

  it("refuses a product id that is not a UUID", () => {
    expect(setCategoryProductsSchema.safeParse({ categoryId, add: ["x"] }).success).toBe(false);
  });
});

describe("categoryFieldErrors", () => {
  it("keeps only the first message for each field", () => {
    // An empty slug fails both min and the pattern; the form shows the first one.
    expect(errorsOf(fields({ slug: "" }))).toEqual({ slug: "Enter a URL name." });
  });
});
