import { beforeEach, describe, expect, it, vi } from "vitest";

import { signCartId } from "@/lib/cart/signature";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createProductWithOptions, createSimpleProduct, inThirtyDays } from "./fixtures";
import { eventsOf, seedPendingOrder } from "./stripe-support";

// startCheckout against a real Postgres; Stripe is stubbed at src/lib/stripe.ts
// (spec 0006, AC-1, AC-2, AC-9 and AC-17; spec 0007, AC-2, AC-5, AC-6, AC-7 and AC-14).

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
    STORE_COUNTRY: "PL",
    STORE_LOCALE: "en",
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

const address = {
  fullName: "Anna Kowalska",
  line1: "ul. Marszałkowska 1",
  line2: "",
  postalCode: "00950",
  city: "Warsaw",
  phone: "",
};

// What the checkout form sends: the email plus a valid delivery address.
function checkout(email = "a@example.com", overrides: Record<string, unknown> = {}) {
  return { email, ...address, ...overrides };
}

async function setShipping(flatShippingCents: number, freeShippingThresholdCents: number | null) {
  await testDb.storeSettings.update({
    where: { id: 1 },
    data: { flatShippingCents, freeShippingThresholdCents },
  });
}

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

    const result = await startCheckout(checkout("  Ada@Example.COM "));

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

    await startCheckout(
      checkout("a@example.com", { totalCents: 1, priceCents: 1, shippingCents: 0 }),
    );

    expect((await testDb.order.findFirstOrThrow()).totalCents).toBe(2500);
  });
});

async function stickerCart(priceCents: number) {
  const product = await testDb.product.create({
    data: { name: "Sticker", slug: "sticker", status: "active" },
  });
  const variant = await testDb.productVariant.create({
    data: {
      productId: product.id,
      sku: "STK",
      priceCents,
      stockQuantity: 9,
      position: 0,
      optionKey: "",
    },
  });
  return cartWith([{ variantId: variant.id, quantity: 1 }]);
}

function sessionParams() {
  const [params] = mocks.create.mock.calls[0]!;
  return params as {
    line_items: { quantity: number; price_data: { unit_amount: number } }[];
    shipping_options: {
      shipping_rate_data: { fixed_amount: { amount: number }; display_name: string };
    }[];
    payment_intent_data: { shipping: unknown };
  };
}

describe("delivery (spec 0007)", () => {
  it("saves the address, the fee and a total that includes it, and sends both to Stripe", async () => {
    await setShipping(1500, 20_000);
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 2 }]);

    const result = await startCheckout(
      checkout("a@example.com", { line2: " m. 4 ", phone: " +48 600 100 200 " }),
    );

    expect(result.ok).toBe(true);
    const order = await testDb.order.findFirstOrThrow();
    expect(order).toMatchObject({
      shipFullName: "Anna Kowalska",
      shipLine1: "ul. Marszałkowska 1",
      shipLine2: "m. 4",
      shipCity: "Warsaw",
      shipPostalCode: "00-950",
      shipCountryCode: "PL",
      phone: "+48 600 100 200",
      customerName: null,
      subtotalCents: 5000,
      shippingCents: 1500,
      totalCents: 6500,
    });

    const params = sessionParams();
    expect(params.shipping_options).toEqual([
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: 1500, currency: "eur" },
          display_name: "Standard delivery",
        },
      },
    ]);
    expect(params.payment_intent_data.shipping).toEqual({
      name: "Anna Kowalska",
      address: {
        line1: "ul. Marszałkowska 1",
        line2: "m. 4",
        city: "Warsaw",
        postal_code: "00-950",
        country: "PL",
      },
      phone: "+48 600 100 200",
    });
    // Stripe's amount_total: the lines plus the one shipping rate.
    const lines = params.line_items
      .map((item) => item.quantity * item.price_data.unit_amount)
      .reduce((sum, cents) => sum + cents, 0);
    const shipping = params.shipping_options[0]!.shipping_rate_data.fixed_amount.amount;
    expect(lines + shipping).toBe(order.totalCents);
  });

  it("stores an empty line 2 and phone as null and leaves them out at Stripe", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);

    await startCheckout(checkout());

    expect(await testDb.order.findFirstOrThrow()).toMatchObject({ shipLine2: null, phone: null });
    expect(sessionParams().payment_intent_data.shipping).toEqual({
      name: "Anna Kowalska",
      address: {
        line1: "ul. Marszałkowska 1",
        city: "Warsaw",
        postal_code: "00-950",
        country: "PL",
      },
    });
  });

  it("delivers free once the subtotal reaches the threshold", async () => {
    await setShipping(1500, 5000);
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 2 }]);

    await startCheckout(checkout());

    expect(await testDb.order.findFirstOrThrow()).toMatchObject({
      subtotalCents: 5000,
      shippingCents: 0,
      totalCents: 5000,
    });
    expect(sessionParams().shipping_options[0]!.shipping_rate_data).toMatchObject({
      fixed_amount: { amount: 0 },
      display_name: "Free delivery",
    });
  });

  it("charges the settings in effect at Pay, even when they changed after the page loaded", async () => {
    await setShipping(500, null);
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);
    // The customer saw 5.00 on /checkout; an admin raises it before they press Pay.
    await setShipping(900, null);

    expect((await startCheckout(checkout())).ok).toBe(true);

    expect(await testDb.order.findFirstOrThrow()).toMatchObject({
      shippingCents: 900,
      totalCents: 3400,
    });
    expect(sessionParams().shipping_options[0]!.shipping_rate_data.fixed_amount.amount).toBe(900);
  });

  it("counts delivery toward Stripe's minimum charge", async () => {
    await setShipping(100, null);
    await stickerCart(30);

    expect((await startCheckout(checkout())).ok).toBe(true);
    expect((await testDb.order.findFirstOrThrow()).totalCents).toBe(130);
  });

  it("refuses a request without a city or with a bad postal code, naming each field", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);

    const result = await startCheckout({
      email: "a@example.com",
      ...address,
      city: undefined,
      postalCode: "00 950",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        fields: { postalCode: "Enter a postal code like 00-950.", city: expect.any(String) },
      },
    });
    expect(await testDb.order.count()).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ignores a fee or country sent by the browser", async () => {
    await setShipping(1500, null);
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);

    await startCheckout(checkout("a@example.com", { shippingCents: 0, countryCode: "DE" }));

    expect(await testDb.order.findFirstOrThrow()).toMatchObject({
      shippingCents: 1500,
      shipCountryCode: "PL",
    });
  });
});

describe("refusals create nothing", () => {
  it("refuses an invalid email with a field error", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);

    const result = await startCheckout(checkout("not-an-email"));

    expect(result).toEqual({
      ok: false,
      error: { code: "validation", fields: { email: "Enter a valid email address." } },
    });
    expect(await testDb.order.count()).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("sends a missing cart back to the cart page", async () => {
    expect(await startCheckout(checkout("a@example.com"))).toEqual({
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

    const result = await startCheckout(checkout("a@example.com"));

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

    const result = await startCheckout(checkout("a@example.com"));

    expect(result).toEqual({ ok: false, error: { code: "below_minimum", minimumCents: 50 } });
    expect(await testDb.order.count()).toBe(0);
  });
});

describe("when Stripe fails", () => {
  it("expires the new order and says payment is unavailable", async () => {
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "api_error" }));

    const result = await startCheckout(checkout("a@example.com"));

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

    expect(await startCheckout(checkout("a@example.com"))).toEqual({
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

    const result = await startCheckout(checkout("a@example.com"));

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

    const result = await startCheckout(checkout("a@example.com"));

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

    const result = await startCheckout(checkout("a@example.com"));

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

    const result = await startCheckout(checkout("a@example.com"));

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

    const result = await startCheckout(checkout("a@example.com"));

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

    const result = await startCheckout(checkout("a@example.com"));

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

    const result = await startCheckout(checkout("a@example.com"));

    expect(result).toEqual({ ok: false, error: { code: "payment_processing" } });
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
  });

  it("expires an earlier order that never got a session without asking Stripe", async () => {
    const { order, cart } = await seedPendingOrder({ sessionId: null });
    selectCart(cart.id);

    const result = await startCheckout(checkout("a@example.com"));

    expect(result.ok).toBe(true);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "expired",
    );
  });

  // Forces the order two submits can race in: this tab reads the earlier order before the other
  // tab saves its session id, and only then tries to expire it.
  it("keeps an earlier order whose session id another tab saved after it was read", async () => {
    const { order, cart } = await seedPendingOrder({ sessionId: null });
    selectCart(cart.id);
    const findFirst = testDb.order.findFirst.bind(testDb.order);
    const spy = vi.spyOn(testDb.order, "findFirst").mockImplementationOnce((async (
      args: Parameters<typeof findFirst>[0],
    ) => {
      const pending = await findFirst(args);
      await testDb.order.update({
        where: { id: order.id },
        data: { stripeCheckoutSessionId: "cs_test_other_tab" },
      });
      return pending;
    }) as unknown as typeof findFirst);

    const result = await startCheckout(checkout("a@example.com"));
    spy.mockRestore();

    expect(result).toEqual({ ok: false, error: { code: "checkout_in_progress" } });
    expect(mocks.create).not.toHaveBeenCalled();
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
    expect(await testDb.order.count()).toBe(1);
  });

  it("answers payment_unavailable and changes nothing when Stripe cannot be reached", async () => {
    const { order, cart } = await seedPendingOrder({ sessionId: "cs_test_old" });
    selectCart(cart.id);
    mocks.retrieve.mockRejectedValueOnce(new Error("network"));

    expect(await startCheckout(checkout("a@example.com"))).toEqual({
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
      startCheckout(checkout("a@example.com")),
      startCheckout(checkout("a@example.com")),
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

    await startCheckout(checkout("secret.person@example.com"));
    await startCheckout(checkout("bad"));

    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "checkout.started", number: 1001, totalCents: 2500 }),
      "checkout.started",
    );
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "checkout.refused", reason: "validation", fields: ["email"] },
      "checkout.refused",
    );
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("secret.person");
  });

  it("log the delivery fee and never a name, address line, postal code or phone", async () => {
    await setShipping(1500, null);
    const { variant } = await createSimpleProduct("a", 5);
    await cartWith([{ variantId: variant.id, quantity: 1 }]);

    await startCheckout(checkout("a@example.com", { line2: "Flat 4B", phone: "+48 600 100 200" }));
    await startCheckout(checkout("a@example.com", { city: "", postalCode: "Warsaw 1" }));

    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "checkout.started", totalCents: 4000, shippingCents: 1500 }),
      "checkout.started",
    );
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "checkout.refused", reason: "validation", fields: ["postalCode", "city"] },
      "checkout.refused",
    );
    const logged = JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls]);
    for (const secretValue of [
      "Kowalska",
      "Marszałkowska",
      "Flat 4B",
      "00-950",
      "600 100",
      "Warsaw",
    ]) {
      expect(logged).not.toContain(secretValue);
    }
  });
});
