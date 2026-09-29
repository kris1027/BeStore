import { beforeEach, describe, expect, it, vi } from "vitest";

import { signCartId } from "@/lib/cart/signature";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createProductWithOptions, createSimpleProduct, inThirtyDays } from "./fixtures";
import { eventsOf, seedPendingOrder } from "./stripe-support";

// startCheckout against a real Postgres; Stripe is stubbed at src/lib/stripe.ts
// (spec 0006, AC-1, AC-2, AC-9 and AC-17).

const secret = "c".repeat(32);

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  create: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: {
    CART_COOKIE_SECRET: "c".repeat(32),
    STORE_CURRENCY: "EUR",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  },
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: { create: mocks.create, retrieve: mocks.retrieve, expire: mocks.expire },
    },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const { startCheckout } = await import("@/features/checkout/actions/start-checkout");

resetDatabaseBeforeEach();

let sessionCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jar.clear();
  mocks.create.mockImplementation(async () => {
    sessionCounter += 1;
    const id = `cs_test_new${sessionCounter}`;
    return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
  });
  mocks.expire.mockResolvedValue({ status: "expired" });
});

function selectCart(cartId: string) {
  mocks.jar.set("bestore_cart", signCartId(cartId, secret));
}

async function cartWith(items: readonly { variantId: string; quantity: number }[]) {
  const cart = await testDb.cart.create({
    data: { expiresAt: inThirtyDays(), items: { create: [...items] } },
  });
  selectCart(cart.id);
  return cart;
}

describe("the happy path", () => {
  it("freezes the cart into one pending order and a Stripe session for exactly it", async () => {
    const { product, variants } = await createProductWithOptions("opt");
    const variant = variants[3]!; // M / Blue
    const image = await testDb.productImage.create({
      data: {
        productId: product.id,
        storagePath: "products/blue.jpg",
        position: 1,
        optionValueId: (
          await testDb.productOptionValue.findFirstOrThrow({
            where: { value: "Blue" },
          })
        ).id,
      },
    });
    await testDb.productImage.create({
      data: { productId: product.id, storagePath: "products/general.jpg", position: 0 },
    });
    const simple = await createSimpleProduct("s", 9);
    const cart = await cartWith([
      { variantId: variant.id, quantity: 2 },
      { variantId: simple.variant.id, quantity: 1 },
    ]);

    const result = await startCheckout({ email: "  Ada@Example.COM " });

    expect(result).toEqual({
      ok: true,
      data: { url: "https://checkout.stripe.com/c/pay/cs_test_new1" },
    });
    const order = await testDb.order.findFirstOrThrow({ include: { lines: true } });
    expect(order).toMatchObject({
      number: 1001,
      status: "pending_payment",
      email: "ada@example.com",
      cartId: cart.id,
      currency: "EUR",
      subtotalCents: 8500,
      discountCents: 0,
      shippingCents: 0,
      totalCents: 8500,
      stripeCheckoutSessionId: "cs_test_new1",
    });
    expect(order.lines.map((line) => [line.sku, line.variantLabel, line.imagePath])).toEqual(
      expect.arrayContaining([
        [variant.sku, "M / Blue", image.storagePath],
        [simple.variant.sku, null, null],
      ]),
    );
    expect((await eventsOf(order.id)).map((e) => [e.type, e.toStatus])).toEqual([
      ["created", "pending_payment"],
    ]);

    const [params, options] = mocks.create.mock.calls[0]!;
    expect(options).toEqual({ idempotencyKey: `checkout:${order.id}` });
    expect(params).toMatchObject({
      mode: "payment",
      customer_email: "ada@example.com",
      metadata: { order_id: order.id },
      client_reference_id: order.id,
      payment_intent_data: { description: "Order #1001" },
    });
    const charged = (
      params.line_items as { quantity: number; price_data: { unit_amount: number } }[]
    )
      .map((item) => item.quantity * item.price_data.unit_amount)
      .reduce((a, b) => a + b, 0);
    expect(charged).toBe(order.totalCents);
    // The cart is untouched until the webhook marks the order paid.
    expect(await testDb.cartItem.count({ where: { cartId: cart.id } })).toBe(2);
  });

  it("takes prices from the database, never from the input", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);

    await startCheckout({ email: "a@example.com", totalCents: 1, priceCents: 1 });

    expect((await testDb.order.findFirstOrThrow()).totalCents).toBe(2500);
  });
});

describe("refusals create nothing", () => {
  it("refuses an invalid email with a field error", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);

    const result = await startCheckout({ email: "not-an-email" });

    expect(result).toEqual({ ok: false, error: { code: "validation", field: "email" } });
    expect(await testDb.order.count()).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("sends a missing cart back to the cart page", async () => {
    expect(await startCheckout({ email: "a@example.com" })).toEqual({
      ok: false,
      error: { code: "cart_changed" },
    });
  });

  it.each([
    ["an empty cart", async () => cartWith([])],
    [
      "a sold out line",
      async () => {
        const { variant } = await createSimpleProduct("a", 0);
        return cartWith([{ variantId: variant.id, quantity: 1 }]);
      },
    ],
    [
      "a line above the stock",
      async () => {
        const { variant } = await createSimpleProduct("a", 1);
        return cartWith([{ variantId: variant.id, quantity: 2 }]);
      },
    ],
    [
      "a draft product",
      async () => {
        const { product, variant } = await createSimpleProduct("a", 5);
        await testDb.product.update({ where: { id: product.id }, data: { status: "draft" } });
        return cartWith([{ variantId: variant.id, quantity: 1 }]);
      },
    ],
  ])("sends %s back to the cart page", async (_, arrange) => {
    await arrange();

    const result = await startCheckout({ email: "a@example.com" });

    expect(result).toEqual({ ok: false, error: { code: "cart_changed" } });
    expect(await testDb.order.count()).toBe(0);
  });

  it("refuses a total below Stripe's minimum charge", async () => {
    const product = await testDb.product.create({
      data: { name: "Sticker", slug: "sticker", status: "active" },
    });
    const variant = await testDb.productVariant.create({
      data: {
        productId: product.id,
        sku: "STK",
        priceCents: 30,
        stockQuantity: 9,
        position: 0,
        optionKey: "",
      },
    });
    await cartWith([{ variantId: variant.id, quantity: 1 }]);

    const result = await startCheckout({ email: "a@example.com" });

    expect(result).toEqual({ ok: false, error: { code: "below_minimum", minimumCents: 50 } });
    expect(await testDb.order.count()).toBe(0);
  });
});

describe("when Stripe fails", () => {
  it("expires the new order and says payment is unavailable", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "api_error" }));

    const result = await startCheckout({ email: "a@example.com" });

    expect(result).toEqual({ ok: false, error: { code: "payment_unavailable" } });
    const order = await testDb.order.findFirstOrThrow();
    expect(order.status).toBe("expired");
    expect((await eventsOf(order.id)).at(-1)?.message).toBe("Stripe session could not be created");
    expect(mocks.error).toHaveBeenCalledWith(
      {
        event: "checkout.stripe_failed",
        orderId: order.id,
        stripeCode: "api_error",
        stripeType: null,
      },
      "checkout.stripe_failed",
    );
  });

  it("maps amount_too_small to the minimum charge message", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);
    mocks.create.mockRejectedValueOnce(
      Object.assign(new Error("small"), { code: "amount_too_small" }),
    );

    expect(await startCheckout({ email: "a@example.com" })).toEqual({
      ok: false,
      error: { code: "below_minimum", minimumCents: 50 },
    });
  });
});

describe("paying twice for one cart", () => {
  it("ends the earlier session at Stripe, expires its order, then starts a new one", async () => {
    const { order: earlier, cart } = await seedPendingOrder({ sessionId: "cs_test_old" });
    selectCart(cart.id);
    mocks.retrieve.mockResolvedValueOnce({
      id: "cs_test_old",
      status: "open",
      payment_status: "unpaid",
    });

    const result = await startCheckout({ email: "a@example.com" });

    expect(result.ok).toBe(true);
    expect(mocks.expire).toHaveBeenCalledWith("cs_test_old");
    expect(await testDb.order.findUniqueOrThrow({ where: { id: earlier.id } })).toMatchObject({
      status: "expired",
    });
    expect((await eventsOf(earlier.id)).at(-1)?.message).toBe("Replaced by a new checkout");
    expect(
      await testDb.order.count({ where: { cartId: cart.id, status: "pending_payment" } }),
    ).toBe(1);
  });

  it("branches again when expiring fails because the session just completed", async () => {
    const { cart } = await seedPendingOrder({ sessionId: "cs_test_old" });
    selectCart(cart.id);
    mocks.retrieve
      .mockResolvedValueOnce({ id: "cs_test_old", status: "open", payment_status: "unpaid" })
      .mockResolvedValueOnce({ id: "cs_test_old", status: "complete", payment_status: "paid" });
    mocks.expire.mockRejectedValueOnce(new Error("session is complete"));

    const result = await startCheckout({ email: "a@example.com" });

    // The webhook has not landed yet, so the order still reads pending.
    expect(result).toEqual({ ok: false, error: { code: "payment_processing" } });
    expect(await testDb.order.count()).toBe(1);
  });

  it("answers already_paid with the confirmation URL when Stripe completed and the webhook landed meanwhile", async () => {
    const { order, cart } = await seedPendingOrder({ sessionId: "cs_test_old" });
    selectCart(cart.id);
    mocks.retrieve.mockImplementationOnce(async () => {
      // The webhook lands between our read of the pending order and Stripe's answer.
      await testDb.order.update({ where: { id: order.id }, data: { status: "paid" } });
      return { id: "cs_test_old", status: "complete", payment_status: "paid" };
    });

    const result = await startCheckout({ email: "a@example.com" });

    expect(result).toEqual({
      ok: false,
      error: { code: "already_paid", confirmationUrl: "/checkout/complete?session_id=cs_test_old" },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(await testDb.order.count()).toBe(1);
  });

  it("starts a new checkout when a delayed payment failed on the earlier session meanwhile", async () => {
    const { order, cart } = await seedPendingOrder({ sessionId: "cs_test_old" });
    selectCart(cart.id);
    mocks.retrieve.mockImplementationOnce(async () => {
      // async_payment_failed lands between our read of the pending order and Stripe's answer.
      await testDb.order.update({ where: { id: order.id }, data: { status: "expired" } });
      return { id: "cs_test_old", status: "complete", payment_status: "unpaid" };
    });

    const result = await startCheckout({ email: "a@example.com" });

    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(
      await testDb.order.count({ where: { cartId: cart.id, status: "pending_payment" } }),
    ).toBe(1);
  });

  it("keeps the earlier order and says it is processing while its delayed payment settles", async () => {
    const { order, cart } = await seedPendingOrder({ sessionId: "cs_test_old" });
    selectCart(cart.id);
    mocks.retrieve.mockResolvedValueOnce({
      id: "cs_test_old",
      status: "complete",
      payment_status: "unpaid",
    });

    const result = await startCheckout({ email: "a@example.com" });

    expect(result).toEqual({ ok: false, error: { code: "payment_processing" } });
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
    expect(await testDb.order.count()).toBe(1);
  });

  // Money may have moved on a session Stripe describes in terms we do not know, so the earlier
  // order is never replaced on it.
  it.each([
    ["an unknown status", { status: "archived", payment_status: "unpaid" }],
    ["no status", { status: null, payment_status: "unpaid" }],
    ["complete with an unknown payment status", { status: "complete", payment_status: "refunded" }],
  ])("never replaces an earlier order whose session has %s", async (_, session) => {
    const { order, cart } = await seedPendingOrder({ sessionId: "cs_test_old" });
    selectCart(cart.id);
    mocks.retrieve.mockResolvedValueOnce({ id: "cs_test_old", ...session });

    const result = await startCheckout({ email: "a@example.com" });

    expect(result).toEqual({ ok: false, error: { code: "payment_processing" } });
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
  });

  it("keeps the earlier order when expiring fails and Stripe then reports an unknown state", async () => {
    const { order, cart } = await seedPendingOrder({ sessionId: "cs_test_old" });
    selectCart(cart.id);
    mocks.retrieve
      .mockResolvedValueOnce({ id: "cs_test_old", status: "open", payment_status: "unpaid" })
      .mockResolvedValueOnce({ id: "cs_test_old", status: "archived", payment_status: "unpaid" });
    mocks.expire.mockRejectedValueOnce(new Error("cannot expire"));

    const result = await startCheckout({ email: "a@example.com" });

    expect(result).toEqual({ ok: false, error: { code: "payment_processing" } });
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
  });

  it("expires an earlier order that never got a session without asking Stripe", async () => {
    const { order, cart } = await seedPendingOrder({ sessionId: null });
    selectCart(cart.id);

    const result = await startCheckout({ email: "a@example.com" });

    expect(result.ok).toBe(true);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "expired",
    );
  });

  it("answers payment_unavailable and changes nothing when Stripe cannot be reached", async () => {
    const { order, cart } = await seedPendingOrder({ sessionId: "cs_test_old" });
    selectCart(cart.id);
    mocks.retrieve.mockRejectedValueOnce(new Error("network"));

    expect(await startCheckout({ email: "a@example.com" })).toEqual({
      ok: false,
      error: { code: "payment_unavailable" },
    });
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
    expect(await testDb.order.count()).toBe(1);
  });

  it("ends two submits at the same moment with one pending order", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    const cart = await cartWith([{ variantId: variant.id, quantity: 1 }]);

    const results = await Promise.all([
      startCheckout({ email: "a@example.com" }),
      startCheckout({ email: "a@example.com" }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({
      ok: false,
      error: { code: "checkout_in_progress" },
    });
    expect(
      await testDb.order.count({ where: { cartId: cart.id, status: "pending_payment" } }),
    ).toBe(1);
  });
});

describe("logs", () => {
  it("log the start and every refusal without the email", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);

    await startCheckout({ email: "secret.person@example.com" });
    await startCheckout({ email: "bad" });

    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "checkout.started", number: 1001, totalCents: 2500 }),
      "checkout.started",
    );
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "checkout.refused", reason: "validation" },
      "checkout.refused",
    );
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("secret.person");
  });
});
