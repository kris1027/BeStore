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

// A product with Size (S, M) and Color (Red, Blue) and one variant per combination,
// with option_key and variant_option_values kept in step as the catalog action will.
export async function createProductWithOptions(suffix = "opt") {
  const product = await createProduct(suffix);
  const size = await testDb.productOptionType.create({
    data: {
      productId: product.id,
      name: "Size",
      position: 0,
      values: {
        create: [
          { value: "S", position: 0 },
          { value: "M", position: 1 },
        ],
      },
    },
    include: { values: true },
  });
  const color = await testDb.productOptionType.create({
    data: {
      productId: product.id,
      name: "Color",
      position: 1,
      values: {
        create: [
          { value: "Red", position: 0 },
          { value: "Blue", position: 1 },
        ],
      },
    },
    include: { values: true },
  });
  const variants = [];
  for (const s of size.values) {
    for (const c of color.values) {
      const ids = [s.id, c.id].toSorted();
      variants.push(
        await testDb.productVariant.create({
          data: {
            productId: product.id,
            sku: `SKU-${suffix}-${s.value}-${c.value}`,
            priceCents: 3000,
            stockQuantity: 3,
            position: variants.length,
            optionKey: ids.join(","),
            optionValues: { create: ids.map((optionValueId) => ({ optionValueId })) },
          },
        }),
      );
    }
  }
  return { product, size, color, variants };
}

export async function createCustomer(email?: string) {
  const id = crypto.randomUUID();
  return testDb.customer.create({ data: { id, email: email ?? `customer-${id}@example.com` } });
}

export function address(customerId: string, isDefault = false) {
  return {
    customerId,
    fullName: "Ada Lovelace",
    line1: "1 Main St",
    city: "Warsaw",
    postalCode: "00-001",
    countryCode: "PL",
    isDefault,
  };
}

export function inThirtyDays() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

type OrderInput = Partial<{
  customerId: string;
  cartId: string;
  email: string;
  status: "pending_payment" | "paid" | "shipped" | "delivered" | "cancelled" | "expired";
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
}>;

// A pending guest order whose totals add up (total = subtotal - discount + shipping).
export async function createOrder(input: OrderInput = {}) {
  const subtotalCents = input.subtotalCents ?? 5000;
  const discountCents = input.discountCents ?? 0;
  const shippingCents = input.shippingCents ?? 0;
  return testDb.order.create({
    data: {
      customerId: input.customerId,
      cartId: input.cartId,
      status: input.status,
      email: input.email ?? "guest@example.com",
      currency: "EUR",
      subtotalCents,
      discountCents,
      shippingCents,
      totalCents: subtotalCents - discountCents + shippingCents,
    },
  });
}

export async function createAdmin(email = "admin@example.com") {
  return testDb.adminUser.create({ data: { id: crypto.randomUUID(), email, name: "Admin" } });
}
