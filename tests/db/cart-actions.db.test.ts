import { beforeEach, describe, expect, it, vi } from "vitest";

import { signCartId } from "@/lib/cart/signature";

import { testDb, resetDatabaseBeforeEach } from "./client";
import { createSimpleProduct } from "./fixtures";

// addToCart against a real Postgres (spec 0005, AC-8, AC-9, AC-15).

const secret = "c".repeat(32);

const mocks = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: unknown }>(),
  refresh: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { CART_COOKIE_SECRET: "c".repeat(32) } }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: mocks.warn } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = mocks.jar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options?: unknown) =>
      mocks.jar.set(name, { value, options }),
  }),
}));

const { addToCart } = await import("@/features/cart/actions");

resetDatabaseBeforeEach();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jar.clear();
});

function cookieCartId(): string | undefined {
  return mocks.jar.get("bestore_cart")?.value.split(".")[0];
}

async function lineQuantity(cartId: string, variantId: string) {
  const item = await testDb.cartItem.findUnique({
    where: { cartId_variantId: { cartId, variantId } },
  });
  return item?.quantity;
}

describe("addToCart", () => {
  it("creates the cart and a signed cookie on the first add, then grows the line", async () => {
    const { variant } = await createSimpleProduct("a", 8);

    const first = await addToCart({ variantId: variant.id, quantity: 2 });
    expect(first).toEqual({ ok: true, data: { lineQuantity: 2, cartQuantity: 2 } });
    const cartId = cookieCartId()!;
    expect(mocks.jar.get("bestore_cart")?.value).toBe(signCartId(cartId, secret));
    expect(mocks.jar.get("bestore_cart")?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });

    const second = await addToCart({ variantId: variant.id, quantity: 3 });
    expect(second).toEqual({ ok: true, data: { lineQuantity: 5, cartQuantity: 5 } });
    expect(cookieCartId()).toBe(cartId);
    expect(await testDb.cart.count()).toBe(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("renews the cart's expiry about 30 days out on every write", async () => {
    const { variant } = await createSimpleProduct("a", 8);
    await addToCart({ variantId: variant.id, quantity: 1 });
    const cart = await testDb.cart.findFirstOrThrow();
    const days = (cart.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("caps a line at the stock and reports it", async () => {
    const { variant } = await createSimpleProduct("a", 3);

    await addToCart({ variantId: variant.id, quantity: 2 });
    const capped = await addToCart({ variantId: variant.id, quantity: 2 });

    expect(capped).toEqual({ ok: true, data: { lineQuantity: 3, cartQuantity: 3, cappedTo: 3 } });
  });

  it("caps a line at 10 whatever the stock", async () => {
    const { variant } = await createSimpleProduct("a", 500);

    await addToCart({ variantId: variant.id, quantity: 8 });
    const capped = await addToCart({ variantId: variant.id, quantity: 8 });

    expect(capped).toEqual({
      ok: true,
      data: { lineQuantity: 10, cartQuantity: 10, cappedTo: 10 },
    });
  });

  it("ends two concurrent adds for the last units at the cap", async () => {
    const { variant } = await createSimpleProduct("a", 4);
    await addToCart({ variantId: variant.id, quantity: 1 });
    const cartId = cookieCartId()!;

    await Promise.all([
      addToCart({ variantId: variant.id, quantity: 3 }),
      addToCart({ variantId: variant.id, quantity: 3 }),
    ]);

    expect(await lineQuantity(cartId, variant.id)).toBe(4);
  });

  it("refuses a sold out variant and writes nothing", async () => {
    const { variant } = await createSimpleProduct("a", 0);

    expect(await addToCart({ variantId: variant.id, quantity: 1 })).toEqual({
      ok: false,
      error: "sold_out",
    });
    expect(await testDb.cart.count()).toBe(0);
    expect(mocks.jar.size).toBe(0);
  });

  it("refuses an archived variant or a product that is not active", async () => {
    const archived = await createSimpleProduct("a", 5);
    await testDb.productVariant.update({
      where: { id: archived.variant.id },
      data: { archived: true },
    });
    const draft = await createSimpleProduct("b", 5);
    await testDb.product.update({ where: { id: draft.product.id }, data: { status: "draft" } });

    for (const variantId of [archived.variant.id, draft.variant.id, crypto.randomUUID()]) {
      expect(await addToCart({ variantId, quantity: 1 })).toEqual({
        ok: false,
        error: "unavailable",
      });
    }
    expect(await testDb.cart.count()).toBe(0);
  });

  it("refuses a quantity outside 1 to 10 and anything that smuggles a price", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    for (const quantity of [0, 11, 1.5]) {
      expect(await addToCart({ variantId: variant.id, quantity })).toEqual({
        ok: false,
        error: "invalid",
      });
    }
    const withPrice = await addToCart({ variantId: variant.id, quantity: 1, priceCents: 1 });
    expect(withPrice.ok).toBe(true);
    const cart = await testDb.cart.findFirstOrThrow({ include: { items: true } });
    expect(cart.items).toHaveLength(1);
  });

  it.each([
    ["a tampered signature", () => `${crypto.randomUUID()}.forged`],
    ["an unknown cart", () => signCartId(crypto.randomUUID(), secret)],
  ])("treats %s as no cart and replaces the cookie", async (_, cookie) => {
    const { variant } = await createSimpleProduct("a", 5);
    mocks.jar.set("bestore_cart", { value: cookie() });

    const result = await addToCart({ variantId: variant.id, quantity: 1 });

    expect(result).toEqual({ ok: true, data: { lineQuantity: 1, cartQuantity: 1 } });
    const cart = await testDb.cart.findFirstOrThrow();
    expect(cookieCartId()).toBe(cart.id);
  });

  it("treats an expired cart as no cart", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    const expired = await testDb.cart.create({ data: { expiresAt: new Date(Date.now() - 1000) } });
    mocks.jar.set("bestore_cart", { value: signCartId(expired.id, secret) });

    await addToCart({ variantId: variant.id, quantity: 1 });

    expect(cookieCartId()).not.toBe(expired.id);
    expect(await testDb.cartItem.count({ where: { cartId: expired.id } })).toBe(0);
  });

  it("logs a bad signature without the cookie value", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    const forged = `${crypto.randomUUID()}.forged`;
    mocks.jar.set("bestore_cart", { value: forged });

    await addToCart({ variantId: variant.id, quantity: 1 });

    expect(mocks.warn).toHaveBeenCalledWith(
      { event: "cart.cookie.invalid" },
      "cart.cookie.invalid",
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("forged");
  });
});
