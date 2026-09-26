import { beforeEach, describe, expect, it, vi } from "vitest";

import { signCartId } from "@/lib/cart/signature";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createProductWithOptions, createSimpleProduct, inThirtyDays } from "./fixtures";

// Loading the cart against a real Postgres: live prices and flags (AC-10, AC-11), a bad or
// expired cookie read as no cart (AC-9), and rendering never writes (AC-11).

const secret = "c".repeat(32);

const mocks = vi.hoisted(() => ({ cookie: undefined as string | undefined, warn: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: { CART_COOKIE_SECRET: "c".repeat(32), NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: mocks.warn } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bestore_cart" && mocks.cookie !== undefined
        ? { name, value: mocks.cookie }
        : undefined,
    set: () => {
      throw new Error("rendering a cart must never set a cookie");
    },
  }),
}));

const { loadCart, loadCartById } = await import("@/lib/cart/load-cart");

resetDatabaseBeforeEach();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookie = undefined;
});

async function cartWith(
  lines: readonly { variantId: string; quantity: number }[],
  expiresAt = inThirtyDays(),
) {
  return testDb.cart.create({
    data: { expiresAt, items: { create: lines.map((line) => ({ ...line })) } },
  });
}

// Everything a render could touch, so a test can prove nothing changed.
async function snapshot() {
  const [carts, items] = await Promise.all([
    testDb.cart.findMany({ orderBy: { id: "asc" } }),
    testDb.cartItem.findMany({ orderBy: { id: "asc" } }),
  ]);
  return { carts, items };
}

describe("loadCartById", () => {
  it("reads lines in the order they were added, with live prices, labels and totals", async () => {
    const { variant: shirt } = await createSimpleProduct("shirt", 8);
    const { product: tee, variants } = await createProductWithOptions("tee");
    const teeVariant = variants.at(-1); // M / Blue
    if (!teeVariant) throw new Error("the fixture builds four variants");
    const cart = await cartWith([{ variantId: shirt.id, quantity: 2 }]);
    await testDb.cartItem.create({
      data: { cartId: cart.id, variantId: teeVariant.id, quantity: 1 },
    });
    await testDb.productVariant.update({ where: { id: shirt.id }, data: { priceCents: 1999 } });

    const loaded = await loadCartById(cart.id, new Date());

    expect(
      loaded?.lines.map((line) => [line.productName, line.variantLabel, line.totalCents]),
    ).toEqual([
      ["Tee shirt", null, 3998],
      [tee.name, "M / Blue", 3000],
    ]);
    expect(loaded).toMatchObject({ quantity: 3, subtotalCents: 6998, canCheckout: true });
    expect(loaded?.lines[0]?.flag).toEqual({ kind: "ok" });
  });

  it("uses the first product image, or a decorative placeholder", async () => {
    const { product, variant } = await createSimpleProduct("pic");
    const { variant: plain } = await createSimpleProduct("plain");
    await testDb.productImage.create({
      data: { productId: product.id, storagePath: "products/a.png", altText: "Front", position: 0 },
    });
    const cart = await cartWith([
      { variantId: variant.id, quantity: 1 },
      { variantId: plain.id, quantity: 1 },
    ]);

    const loaded = await loadCartById(cart.id, new Date());

    expect(loaded?.lines.map((line) => line.image)).toEqual([
      {
        src: "http://127.0.0.1:55321/storage/v1/object/public/product-images/products/a.png",
        alt: "Front",
      },
      { src: "/placeholder.svg", alt: "" },
    ]);
  });

  it("flags stale lines and blocks checkout, writing nothing", async () => {
    const { variant: short } = await createSimpleProduct("short", 5);
    const { variant: gone } = await createSimpleProduct("gone", 5);
    const { product: drafted, variant: hidden } = await createSimpleProduct("hidden", 5);
    const cart = await cartWith([
      { variantId: short.id, quantity: 4 },
      { variantId: gone.id, quantity: 1 },
      { variantId: hidden.id, quantity: 1 },
    ]);
    await testDb.productVariant.update({ where: { id: short.id }, data: { stockQuantity: 2 } });
    await testDb.productVariant.update({ where: { id: gone.id }, data: { stockQuantity: 0 } });
    await testDb.product.update({ where: { id: drafted.id }, data: { status: "draft" } });
    const before = await snapshot();

    const loaded = await loadCartById(cart.id, new Date());

    const flagOf = (variantId: string) =>
      loaded?.lines.find((line) => line.variantId === variantId)?.flag;
    expect(flagOf(short.id)).toEqual({ kind: "insufficient", left: 2 });
    expect(flagOf(gone.id)).toEqual({ kind: "sold_out" });
    expect(flagOf(hidden.id)).toEqual({ kind: "unavailable" });
    expect(loaded?.canCheckout).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it("gives an empty cart that cannot check out", async () => {
    const cart = await cartWith([]);

    expect(await loadCartById(cart.id, new Date())).toMatchObject({
      lines: [],
      quantity: 0,
      subtotalCents: 0,
      canCheckout: false,
    });
  });

  it("is null for an unknown cart", async () => {
    expect(await loadCartById(crypto.randomUUID(), new Date())).toBeNull();
  });

  it("is null for a cart past expires_at, and leaves it for the cron to delete", async () => {
    const cart = await cartWith([], new Date(Date.now() - 1000));

    expect(await loadCartById(cart.id, new Date())).toBeNull();
    expect(await testDb.cart.count()).toBe(1);
  });
});

describe("loadCart", () => {
  it("loads the cart the signed cookie names", async () => {
    const cart = await cartWith([]);
    mocks.cookie = signCartId(cart.id, secret);

    expect((await loadCart())?.id).toBe(cart.id);
  });

  it("is null without a cookie", async () => {
    expect(await loadCart()).toBeNull();
  });

  it("is null, not an error, for a cookie with a bad signature", async () => {
    const cart = await cartWith([]);
    mocks.cookie = `${cart.id}.${"A".repeat(43)}`;

    expect(await loadCart()).toBeNull();
    expect(mocks.warn).toHaveBeenCalledWith(
      { event: "cart.cookie.invalid" },
      "cart.cookie.invalid",
    );
  });
});
