import { describe, expect, it } from "vitest";

import { expectViolation, SQLSTATE, testDb, resetDatabaseBeforeEach } from "./client";
import {
  createProduct,
  createProductWithOptions,
  createSimpleProduct,
  createVariant,
} from "./fixtures";

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

describe("catalog uniqueness (AC-5)", () => {
  it("rejects a second variant with the same option combination", async () => {
    const { product, variants } = await createProductWithOptions();
    const first = variants[0]!;

    await expectViolation(
      createVariant(product.id, { sku: "SKU-DUP", optionKey: first.optionKey }),
      SQLSTATE.unique,
      "product_variants_product_id_option_key_key",
    );
  });

  it("rejects a second default variant on the same product", async () => {
    const { product } = await createSimpleProduct();

    await expectViolation(
      createVariant(product.id, { sku: "SKU-OTHER" }),
      SQLSTATE.unique,
      "product_variants_product_id_option_key_key",
    );
  });

  it("allows the same option combination on different products", async () => {
    const a = await createProduct("a");
    const b = await createProduct("b");
    await createVariant(a.id, { sku: "SKU-A" });

    await expect(createVariant(b.id, { sku: "SKU-B" })).resolves.toBeDefined();
  });

  it("rejects a duplicate SKU", async () => {
    const { variant } = await createSimpleProduct("a");
    const other = await createProduct("b");

    await expectViolation(
      createVariant(other.id, { sku: variant.sku }),
      SQLSTATE.unique,
      "product_variants_sku_key",
    );
  });

  it("rejects a duplicate product slug", async () => {
    await createProduct("same");

    await expectViolation(createProduct("same"), SQLSTATE.unique, "products_slug_key");
  });

  it("rejects a duplicate category slug", async () => {
    const category = { name: "Tops", slug: "tops", position: 0 };
    await testDb.category.create({ data: category });

    await expectViolation(
      testDb.category.create({ data: category }),
      SQLSTATE.unique,
      "categories_slug_key",
    );
  });

  it("rejects a duplicate option name on a product and a duplicate value on an option", async () => {
    const { product, size } = await createProductWithOptions();

    await expectViolation(
      testDb.productOptionType.create({
        data: { productId: product.id, name: "Size", position: 2 },
      }),
      SQLSTATE.unique,
      "product_option_types_product_id_name_key",
    );
    await expectViolation(
      testDb.productOptionValue.create({
        data: { optionTypeId: size.id, value: "S", position: 2 },
      }),
      SQLSTATE.unique,
      "product_option_values_option_type_id_value_key",
    );
  });
});

describe("catalog relations", () => {
  it("refuses to delete an option value a variant still uses", async () => {
    const { size } = await createProductWithOptions();

    await expectViolation(
      testDb.productOptionValue.delete({ where: { id: size.values[0]!.id } }),
      SQLSTATE.foreignKey,
    );
  });

  it("deletes options, variants, images and category links with the product", async () => {
    const { product, size } = await createProductWithOptions();
    const category = await testDb.category.create({
      data: { name: "Tops", slug: "tops", position: 0 },
    });
    await testDb.productCategory.create({
      data: { productId: product.id, categoryId: category.id, position: 0 },
    });
    await testDb.productImage.create({
      data: {
        productId: product.id,
        storagePath: "products/tee/1.jpg",
        position: 0,
        optionValueId: size.values[0]!.id,
      },
    });

    await testDb.product.delete({ where: { id: product.id } });

    const counts = await Promise.all([
      testDb.productOptionType.count(),
      testDb.productOptionValue.count(),
      testDb.productVariant.count(),
      testDb.variantOptionValue.count(),
      testDb.productImage.count(),
      testDb.productCategory.count(),
      testDb.category.count(),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it("keeps an image when its option value goes away, unlinked", async () => {
    const product = await createProduct();
    const size = await testDb.productOptionType.create({
      data: {
        productId: product.id,
        name: "Size",
        position: 0,
        values: { create: [{ value: "S", position: 0 }] },
      },
      include: { values: true },
    });
    const image = await testDb.productImage.create({
      data: {
        productId: product.id,
        storagePath: "products/tee/s.jpg",
        position: 0,
        optionValueId: size.values[0]!.id,
      },
    });

    await testDb.productOptionType.delete({ where: { id: size.id } });

    const after = await testDb.productImage.findUniqueOrThrow({ where: { id: image.id } });
    expect(after.optionValueId).toBeNull();
  });

  it("rejects a duplicate image storage path", async () => {
    const product = await createProduct();
    const image = { productId: product.id, storagePath: "products/tee/1.jpg", position: 0 };
    await testDb.productImage.create({ data: image });

    await expectViolation(
      testDb.productImage.create({ data: { ...image, position: 1 } }),
      SQLSTATE.unique,
      "product_images_storage_path_key",
    );
  });
});
