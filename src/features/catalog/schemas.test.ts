import { describe, expect, it } from "vitest";

import { pathErrors, productFormSchema, type ProductFormInput } from "./schemas";

const schema = productFormSchema("EUR");

function product(overrides: Partial<ProductFormInput> = {}): ProductFormInput {
  return {
    name: "Linen shirt",
    slug: "linen-shirt",
    description: "",
    optionTypes: [],
    variants: [{ values: [], price: "19.99", stock: "3", sku: "linen-shirt" }],
    ...overrides,
  };
}

function errorsOf(input: ProductFormInput) {
  const result = schema.safeParse(input);
  return result.success ? {} : pathErrors(result.error);
}

const sizeAndColor = {
  optionTypes: [
    { name: "Size", values: ["S", "M"] },
    { name: "Color", values: ["Red"] },
  ],
  variants: [
    { values: ["S", "Red"], price: "10", stock: "1", sku: "A" },
    { values: ["M", "Red"], price: "12.5", stock: "0", sku: "B" },
  ],
};

// covers: spec 0005 AC-2, AC-4
describe("productFormSchema", () => {
  it("parses prices to cents, stock to a number and SKUs to upper case", () => {
    const parsed = schema.parse(product());
    expect(parsed.variants).toEqual([{ values: [], price: 1999, stock: 3, sku: "LINEN-SHIRT" }]);
  });

  it("accepts one variant per combination of the options", () => {
    expect(errorsOf(product(sizeAndColor))).toEqual({});
  });

  it.each([
    ["Bad Slug", "Use lowercase letters and digits, joined by single hyphens."],
    ["a--b", "Use lowercase letters and digits, joined by single hyphens."],
    ["", "Enter a URL name."],
  ])("refuses the slug %j, showing this message first", (slug, message) => {
    expect(errorsOf(product({ slug })).slug?.[0]).toBe(message);
  });

  it.each([
    ["19.999", "This currency does not have that many decimals."],
    ["abc", "Enter a price like 19.99."],
    ["0", "Enter a price above zero."],
    ["0.00", "Enter a price above zero."],
    ["-1", "Enter a price like 19.99."],
  ])("refuses the price %j on its field", (price, message) => {
    const variants = [{ values: [], price, stock: "1", sku: "X" }];
    expect(errorsOf(product({ variants }))["variants.0.price"]).toEqual([message]);
  });

  it.each([
    ["-1", "Enter a whole number."],
    ["1.5", "Enter a whole number."],
    ["1000000", "Stock goes up to 999999."],
  ])("refuses the stock %j on its field", (stock, message) => {
    const variants = [{ values: [], price: "1", stock, sku: "X" }];
    expect(errorsOf(product({ variants }))["variants.0.stock"]).toEqual([message]);
  });

  it("accepts stock from 0 to 999999", () => {
    for (const stock of ["0", "999999"]) {
      const variants = [{ values: [], price: "1", stock, sku: "X" }];
      expect(errorsOf(product({ variants }))).toEqual({});
    }
  });

  it("refuses the same SKU twice in the form, ignoring case", () => {
    const variants = sizeAndColor.variants.map((variant) => ({ ...variant, sku: "same" }));
    variants[1] = { ...sizeAndColor.variants[1]!, sku: "SAME" };
    expect(errorsOf(product({ ...sizeAndColor, variants }))["variants.1.sku"]).toEqual([
      "Another variant uses this SKU.",
    ]);
  });

  it("refuses a duplicate option name or value, ignoring case", () => {
    const errors = errorsOf(
      product({
        optionTypes: [
          { name: "Size", values: ["S", "s"] },
          { name: "size", values: ["Red"] },
        ],
        variants: [],
      }),
    );
    expect(errors["optionTypes.0.values.1"]).toEqual(["This value is already there."]);
    expect(errors["optionTypes.1.name"]).toEqual(["This option is already there."]);
  });

  it("refuses more than 100 combinations", () => {
    const values = ["1", "2", "3", "4", "5"];
    const errors = errorsOf(
      product({
        optionTypes: [
          { name: "A", values },
          { name: "B", values },
          { name: "C", values },
        ],
        variants: [],
      }),
    );
    expect(errors.optionTypes).toEqual([
      "These options make more than 100 variants. Remove some values.",
    ]);
  });

  it("refuses variants that do not match the options", () => {
    const missing = { ...sizeAndColor, variants: sizeAndColor.variants.slice(0, 1) };
    const duplicated = {
      ...sizeAndColor,
      variants: [sizeAndColor.variants[0]!, { ...sizeAndColor.variants[0]!, sku: "C" }],
    };
    for (const input of [missing, duplicated]) {
      expect(errorsOf(product(input)).variants).toEqual([
        "The variants do not match the options. Reload the page and try again.",
      ]);
    }
  });

  it("refuses more than 3 options and more than 10 values", () => {
    const tooMany = Array.from({ length: 4 }, (_, i) => ({ name: `O${i}`, values: ["x"] }));
    expect(errorsOf(product({ optionTypes: tooMany })).optionTypes).toContain("Up to 3 options.");

    const values = Array.from({ length: 11 }, (_, i) => `v${i}`);
    expect(
      errorsOf(product({ optionTypes: [{ name: "Size", values }] }))["optionTypes.0.values"],
    ).toEqual(["Up to 10 values."]);
  });
});
