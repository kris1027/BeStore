import { testDb } from "./client";

// Small builders for the db suites. Each returns the created rows; unique fields take a
// suffix so one test can create several without clashing.

export async function createProduct(suffix = "1") {
  return testDb.product.create({
    data: { name: `Tee ${suffix}`, slug: `tee-${suffix}`, status: "active" },
  });
}

export async function createVariant(
  productId: string,
  overrides: Partial<{
    sku: string;
    priceCents: number;
    stockQuantity: number;
    optionKey: string;
    position: number;
  }> = {},
) {
  return testDb.productVariant.create({
    data: {
      productId,
      sku: overrides.sku ?? `SKU-${productId.slice(-6)}-${overrides.optionKey ?? "default"}`,
      priceCents: overrides.priceCents ?? 2500,
      stockQuantity: overrides.stockQuantity ?? 5,
      optionKey: overrides.optionKey ?? "",
      position: overrides.position ?? 0,
    },
  });
}

// A product with no options: exactly one variant, option_key "".
export async function createSimpleProduct(suffix = "1", stockQuantity = 5) {
  const product = await createProduct(suffix);
  const variant = await createVariant(product.id, { sku: `SKU-${suffix}`, stockQuantity });
  return { product, variant };
}
