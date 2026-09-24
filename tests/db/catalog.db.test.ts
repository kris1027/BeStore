import { describe, expect, it } from "vitest";

import { expectViolation, SQLSTATE, testDb, resetDatabaseBeforeEach } from "./client";
import { createProduct, createSimpleProduct, createVariant } from "./fixtures";

resetDatabaseBeforeEach();

describe("variant stock (AC-4)", () => {
  it("rejects a direct update to a negative stock", async () => {
    const { variant } = await createSimpleProduct();

    await expectViolation(
      testDb.$executeRaw`UPDATE product_variants SET stock_quantity = -1 WHERE id = ${variant.id}::uuid`,
      SQLSTATE.check,
      "product_variants_stock_quantity_check",
    );
  });

  it("updates no row when a conditional decrement asks for more than is in stock", async () => {
    const { variant } = await createSimpleProduct("1", 2);

    const updated = await testDb.$executeRaw`
      UPDATE product_variants SET stock_quantity = stock_quantity - 3
      WHERE id = ${variant.id}::uuid AND stock_quantity >= 3`;

    expect(updated).toBe(0);
    const after = await testDb.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQuantity).toBe(2);
  });

  it("lets exactly one of two concurrent decrements take the last unit", async () => {
    const { variant } = await createSimpleProduct("1", 1);
    const decrement = () =>
      testDb.$transaction(
        (tx) =>
          tx.$executeRaw`
          UPDATE product_variants SET stock_quantity = stock_quantity - 1
          WHERE id = ${variant.id}::uuid AND stock_quantity >= 1`,
      );

    const results = await Promise.all([decrement(), decrement()]);

    expect(results.toSorted()).toEqual([0, 1]);
    const after = await testDb.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQuantity).toBe(0);
  });
});

describe("variant prices", () => {
  it("rejects a negative price", async () => {
    const product = await createProduct();

    await expectViolation(
      createVariant(product.id, { priceCents: -1 }),
      SQLSTATE.check,
      "product_variants_price_cents_check",
    );
  });

  it("rejects a compare at price that is not above the price", async () => {
    const { variant } = await createSimpleProduct();

    await expectViolation(
      testDb.productVariant.update({
        where: { id: variant.id },
        data: { compareAtPriceCents: variant.priceCents },
      }),
      SQLSTATE.check,
      "product_variants_compare_at_price_cents_check",
    );
  });

  it("rejects raising the price to the compare at price", async () => {
    const { variant } = await createSimpleProduct();
    await testDb.productVariant.update({
      where: { id: variant.id },
      data: { compareAtPriceCents: 4000 },
    });

    await expectViolation(
      testDb.productVariant.update({ where: { id: variant.id }, data: { priceCents: 4000 } }),
      SQLSTATE.check,
      "product_variants_compare_at_price_cents_check",
    );
  });

  it("rejects a weight of zero", async () => {
    await expectViolation(
      testDb.product.create({ data: { name: "Mug", slug: "mug", weightGrams: 0 } }),
      SQLSTATE.check,
      "products_weight_grams_check",
    );
  });
});
