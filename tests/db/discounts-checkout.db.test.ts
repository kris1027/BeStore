import { beforeEach, describe, expect, it, vi } from "vitest";

import { signCartId } from "@/lib/cart/signature";

import { resetDatabaseBeforeEach, testDb } from "./client";
import {
  codeAdminId,
  createCustomer,
  createOrder,
  createSimpleProduct,
  holding,
  inThirtyDays,
} from "./fixtures";

// Promo codes at checkout against a real Postgres; Stripe is stubbed at src/lib/stripe.ts
// (spec 0014, AC-1 to AC-9 and AC-16 to AC-18).

const secret = "c".repeat(32);

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  create: vi.fn(),
  createCoupon: vi.fn(),
  retrieve: vi.fn(),
  expire: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  customer: null as { id: string; email: string } | null,
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
    coupons: { create: mocks.createCoupon },
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
    set: (name: string, value: string) => mocks.jar.set(name, value),
    delete: (name: string) => mocks.jar.delete(name),
  }),
}));
vi.mock("@/lib/customer/session", () => ({
  getCustomer: async () => mocks.customer,
  getCustomerId: async () => mocks.customer?.id ?? null,
}));

const { startCheckout } = await import("@/features/checkout/actions/start-checkout");
const { applyDiscountCode } = await import("@/features/checkout/actions/apply-discount");
const { prefillDiscountCode } = await import("@/features/checkout/queries");
const { countRedemptions, lockCode, previewDiscount, redeem } =
  await import("@/lib/discounts/codes");
const { markCancelled, markExpired } = await import("@/lib/orders/transitions");
const { suggestedCents } = await import("@/features/orders/refund-math");

resetDatabaseBeforeEach();

let sessionCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jar.clear();
  mocks.customer = null;
  mocks.create.mockImplementation(async () => {
    sessionCounter += 1;
    const id = `cs_test_code${sessionCounter}`;
    return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
  });
  mocks.createCoupon.mockImplementation(async (params: { id: string }) => ({ id: params.id }));
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

function pay(discountCode?: string, email = "a@example.com") {
  return startCheckout({ email, ...address, ...(discountCode ? { discountCode } : {}) });
}

async function createCode(
  overrides: Partial<{
    code: string;
    type: "percent" | "fixed_amount";
    value: number;
    active: boolean;
    startsAt: Date;
    endsAt: Date;
    maxRedemptions: number;
    perCustomerLimit: number;
    minSubtotalCents: number;
  }> = {},
) {
  return testDb.discountCode.create({
    data: {
      createdByAdminId: await codeAdminId(),
      code: "SUMMER10",
      type: "percent",
      value: 10,
      ...overrides,
    },
  });
}

// A cart in the visitor's cookie with these lines.
async function cartWith(
  lines: readonly { readonly priceCents: number; readonly quantity: number }[],
) {
  const items = [];
  for (const [index, line] of lines.entries()) {
    const { variant } = await createSimpleProduct(
      `p${index}-${crypto.randomUUID().slice(0, 6)}`,
      9,
    );
    await testDb.productVariant.update({
      where: { id: variant.id },
      data: { priceCents: line.priceCents },
    });
    items.push({ variantId: variant.id, quantity: line.quantity });
  }
  const cart = await testDb.cart.create({
    data: { expiresAt: inThirtyDays(), items: { create: items } },
  });
  mocks.jar.set("bestore_cart", signCartId(cart.id, secret));
  return cart;
}

// An order that used the code: paid (a spent use) or pending (a held use).
async function usedBy(
  codeId: string,
  options: {
    email?: string;
    status?: "paid" | "pending_payment" | "expired";
    createdAt?: Date;
  } = {},
) {
  const status = options.status ?? "paid";
  const order = await createOrder({ status, email: options.email ?? "other@example.com" });
  await testDb.order.update({
    where: { id: order.id },
    data: {
      ...(status === "paid" ? { paidAt: new Date() } : {}),
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  });
  await testDb.discountRedemption.create({
    data: { discountCodeId: codeId, orderId: order.id, email: order.email },
  });
  return order;
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000);
}

describe("Pay with a code (AC-4, AC-6, AC-7)", () => {
  it("writes the snapshot, splits the discount onto the lines and takes one use", async () => {
    const code = await createCode();
    const cart = await cartWith([
      { priceCents: 3000, quantity: 1 },
      { priceCents: 2500, quantity: 2 },
    ]);

    const result = await pay(" summer10 ", "Ada@Example.com");

    expect(result.ok).toBe(true);
    const order = await testDb.order.findFirstOrThrow({
      where: { cartId: cart.id },
      include: { lines: { orderBy: { unitPriceCents: "desc" } }, redemption: true },
    });
    expect(order).toMatchObject({
      subtotalCents: 8000,
      discountCents: 800,
      shippingCents: 0,
      totalCents: 7200,
      discountCodeId: code.id,
      discountCode: "SUMMER10",
      discountType: "percent",
      discountValue: 10,
    });
    expect(order.lines.map((line) => [line.discountCents, line.lineTotalCents])).toEqual([
      [300, 2700],
      [500, 4500],
    ]);
    expect(order.redemption).toMatchObject({ discountCodeId: code.id, email: "ada@example.com" });
  });

  it("creates the one off coupon with the exact amount and passes it to the session", async () => {
    await createCode({ type: "fixed_amount", value: 1250 });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);

    await pay("SUMMER10");

    const order = await testDb.order.findFirstOrThrow();
    const [couponParams, couponOptions] = mocks.createCoupon.mock.calls[0]!;
    expect(couponParams).toEqual({
      id: `order_${order.id}`,
      amount_off: 1250,
      currency: "eur",
      duration: "once",
      max_redemptions: 1,
      name: "SUMMER10",
      metadata: { order_id: order.id },
    });
    expect(couponOptions).toEqual({ idempotencyKey: `coupon:${order.id}` });
    const [params] = mocks.create.mock.calls[0]!;
    expect(params.discounts).toEqual([{ coupon: `order_${order.id}` }]);
    // What Stripe charges: the lines less the coupon, plus delivery, equals our total.
    const items = (params.line_items as { quantity: number; price_data: { unit_amount: number } }[])
      .map((item) => item.quantity * item.price_data.unit_amount)
      .reduce((a, b) => a + b, 0);
    expect(items - 1250 + order.shippingCents).toBe(order.totalCents);
    expect(order.totalCents).toBe(3750);
  });

  it("sends no coupon and no discounts without a code", async () => {
    await cartWith([{ priceCents: 5000, quantity: 1 }]);

    await pay();

    expect(mocks.createCoupon).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0]![0]).not.toHaveProperty("discounts");
    expect(await testDb.discountRedemption.count()).toBe(0);
  });

  it("reuses a coupon Stripe says already exists", async () => {
    await createCode();
    await cartWith([{ priceCents: 5000, quantity: 1 }]);
    mocks.createCoupon.mockRejectedValue(
      Object.assign(new Error("exists"), { code: "resource_already_exists" }),
    );

    const result = await pay("SUMMER10");

    expect(result.ok).toBe(true);
    const order = await testDb.order.findFirstOrThrow();
    expect(mocks.create.mock.calls[0]![0].discounts).toEqual([{ coupon: `order_${order.id}` }]);
  });

  it("expires the order and frees the use when the coupon cannot be created", async () => {
    await createCode({ maxRedemptions: 1 });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);
    mocks.createCoupon.mockRejectedValue(Object.assign(new Error("down"), { code: "api_error" }));

    expect(await pay("SUMMER10")).toEqual({
      ok: false,
      error: { code: "payment_unavailable" },
    });
    const order = await testDb.order.findFirstOrThrow({ include: { events: true } });
    expect(order.status).toBe("expired");
    expect(order.events.map((event) => event.message)).toContain(
      "Stripe coupon could not be created",
    );
    expect(await testDb.discountRedemption.count()).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "checkout.coupon_failed", orderId: order.id }),
      "checkout.coupon_failed",
    );
  });

  it("caps the discount to keep the total at Stripe's minimum", async () => {
    await createCode({ type: "fixed_amount", value: 10_000 });
    await cartWith([{ priceCents: 3000, quantity: 1 }]);

    await pay("SUMMER10");

    expect(await testDb.order.findFirstOrThrow()).toMatchObject({
      discountCents: 2950,
      totalCents: 50,
    });
  });

  it("logs the discount on checkout.started, never the email", async () => {
    const code = await createCode();
    await cartWith([{ priceCents: 5000, quantity: 1 }]);

    await pay("SUMMER10", "secret@example.com");

    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "checkout.started",
        discountCents: 500,
        discountCodeId: code.id,
      }),
      "checkout.started",
    );
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("secret@example.com");
  });
});

describe("Pay refuses a code that no longer applies (AC-3, AC-4)", () => {
  it("refuses a code deactivated after Apply and creates no order", async () => {
    const code = await createCode();
    await cartWith([{ priceCents: 5000, quantity: 1 }]);
    expect((await applyDiscountCode({ code: "SUMMER10" })).ok).toBe(true);
    await testDb.discountCode.update({ where: { id: code.id }, data: { active: false } });

    expect(await pay("SUMMER10")).toEqual({
      ok: false,
      error: { code: "discount_refused", reason: "invalid" },
    });
    expect(await testDb.order.count()).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "checkout.discount_refused",
        stage: "pay",
        reason: "invalid",
        discountCodeId: code.id,
      }),
      "checkout.discount_refused",
    );
  });

  it.each([
    ["an unknown code", "NOPE", "invalid"],
    ["text that is not a code", "10% off", "invalid"],
  ])("refuses %s as invalid without logging its text", async (_label, text) => {
    await cartWith([{ priceCents: 5000, quantity: 1 }]);

    expect(await pay(text)).toEqual({
      ok: false,
      error: { code: "discount_refused", reason: "invalid" },
    });
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain(text);
  });

  it("refuses an expired code and one not started yet", async () => {
    await createCode({ code: "OLD", endsAt: minutesAgo(1) });
    await createCode({ code: "SOON", startsAt: new Date(Date.now() + 60_000) });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);

    expect(await pay("OLD")).toMatchObject({ error: { reason: "expired" } });
    expect(await pay("SOON")).toMatchObject({ error: { reason: "invalid" } });
  });

  it("refuses below the minimum subtotal with the gap", async () => {
    await createCode({ minSubtotalCents: 6000 });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);

    expect(await pay("SUMMER10")).toEqual({
      ok: false,
      error: { code: "discount_refused", reason: "below_minimum_subtotal", minimumGapCents: 1000 },
    });
  });

  it("refuses a code used up, and one this email already used, counting by order email", async () => {
    const up = await createCode({ code: "ONCE", maxRedemptions: 1 });
    const mine = await createCode({ code: "MINE", perCustomerLimit: 1 });
    await usedBy(up.id);
    await usedBy(mine.id, { email: "a@example.com" });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);

    expect(await pay("ONCE")).toMatchObject({ error: { reason: "used_up" } });
    expect(await pay("MINE", " A@Example.com ")).toMatchObject({
      error: { reason: "customer_limit" },
    });
    expect((await pay("MINE", "b@example.com")).ok).toBe(true);
  });

  it("answers below_minimum before checking the code", async () => {
    await cartWith([{ priceCents: 40, quantity: 1 }]);

    expect(await pay("NOPE")).toMatchObject({ error: { code: "below_minimum" } });
  });

  it("refuses a code the caps leave at 0", async () => {
    await createCode({ type: "fixed_amount", value: 100 });
    await cartWith([{ priceCents: 50, quantity: 1 }]);

    expect(await pay("SUMMER10")).toMatchObject({ error: { reason: "too_small" } });
  });
});

describe("the use rule (AC-3)", () => {
  it("counts paid orders and fresh pending holds, not stale or expired ones", async () => {
    const code = await createCode();
    await usedBy(code.id, { email: "a@example.com" });
    await usedBy(code.id, { status: "pending_payment", createdAt: minutesAgo(10) });
    await usedBy(code.id, { status: "pending_payment", createdAt: minutesAgo(36) });
    await usedBy(code.id, { status: "expired" });

    expect(await countRedemptions(testDb, code.id, { email: " A@example.com" })).toEqual({
      uses: 2,
      customerUses: 1,
    });
    expect(await countRedemptions(testDb, code.id)).toEqual({ uses: 2, customerUses: null });
  });

  it("leaves out this cart's own pending order on Apply, not on Pay", async () => {
    const code = await createCode({ maxRedemptions: 1, perCustomerLimit: 1 });
    const cart = await cartWith([{ priceCents: 5000, quantity: 1 }]);
    expect((await pay("SUMMER10")).ok).toBe(true);

    expect(await countRedemptions(testDb, code.id, { exceptCartId: cart.id })).toEqual({
      uses: 0,
      customerUses: null,
    });
    expect((await countRedemptions(testDb, code.id)).uses).toBe(1);
    expect((await applyDiscountCode({ code: "SUMMER10", email: "a@example.com" })).ok).toBe(true);
  });
});

describe("the redemption lifecycle (AC-8, AC-9)", () => {
  it("frees the use when a pending order expires or is cancelled, and keeps a paid one's", async () => {
    const code = await createCode();
    const expiring = await usedBy(code.id, { status: "pending_payment" });
    const cancelling = await usedBy(code.id, { status: "pending_payment" });
    const paid = await usedBy(code.id);
    const admin = await codeAdminId();

    await testDb.$transaction((tx) => markExpired(tx, expiring.id, "test"));
    await testDb.$transaction((tx) =>
      markCancelled(tx, {
        orderId: cancelling.id,
        adminId: admin,
        from: "pending_payment",
        reason: "test",
      }),
    );
    await testDb.$transaction((tx) =>
      markCancelled(tx, { orderId: paid.id, adminId: admin, from: "paid", reason: "test" }),
    );

    const left = await testDb.discountRedemption.findMany({ select: { orderId: true } });
    expect(left).toEqual([{ orderId: paid.id }]);
  });

  it("lets a customer restart checkout with a per customer limit of 1", async () => {
    await createCode({ perCustomerLimit: 1, maxRedemptions: 1 });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);
    expect((await pay("SUMMER10")).ok).toBe(true);
    mocks.retrieve.mockResolvedValue({ status: "open", payment_status: "unpaid" });

    expect((await pay("SUMMER10")).ok).toBe(true);

    const orders = await testDb.order.findMany({ orderBy: { number: "asc" } });
    expect(orders.map((order) => order.status)).toEqual(["expired", "pending_payment"]);
    const redemptions = await testDb.discountRedemption.findMany();
    expect(redemptions.map((r) => r.orderId)).toEqual([orders[1]!.id]);
  });

  it("brings the code of the cart's latest pending or expired order back to the page", async () => {
    await createCode();
    const cart = await cartWith([{ priceCents: 5000, quantity: 1 }]);
    expect(await prefillDiscountCode(cart.id)).toBeNull();
    await pay("SUMMER10", "ada@example.com");

    expect(await prefillDiscountCode(cart.id)).toEqual({
      code: "SUMMER10",
      email: "ada@example.com",
    });
    const order = await testDb.order.findFirstOrThrow();
    await testDb.$transaction((tx) => markExpired(tx, order.id, "test"));
    expect(await prefillDiscountCode(cart.id)).toMatchObject({ code: "SUMMER10" });
    expect(await prefillDiscountCode(cart.id, Date.now() + 25 * 60 * 60 * 1000)).toBeNull();
  });

  it("shows a returning code applied while it passes, else refused for the prefilled email", async () => {
    const code = await createCode({ perCustomerLimit: 1 });
    const cart = await cartWith([{ priceCents: 5000, quantity: 1 }]);
    await pay("SUMMER10", "ada@example.com");

    expect(
      await previewDiscount({ cartId: cart.id, codeText: "SUMMER10", email: "ada@example.com" }),
    ).toMatchObject({ kind: "applied", discountCents: 500, totalCents: 4500 });

    await usedBy(code.id, { email: "ada@example.com" });
    expect(
      await previewDiscount({ cartId: cart.id, codeText: "SUMMER10", email: "ada@example.com" }),
    ).toMatchObject({ kind: "refused", reason: "customer_limit" });
  });
});

describe("two checkouts racing (AC-5)", () => {
  it("lets exactly one take the last use", async () => {
    const code = await createCode({ maxRedemptions: 1 });
    const other = await createOrder({ email: "first@example.com" });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);
    // The first checkout holds the code lock and takes the last use, then commits.
    const race = holding(
      (tx) => lockCode(tx, { id: code.id }),
      (tx) => redeem(tx, { codeId: code.id, orderId: other.id, email: "first@example.com" }),
    );
    await race.locked;

    const second = pay("SUMMER10");
    await new Promise((resolve) => setTimeout(resolve, 200));
    race.release();
    await race.done;

    expect(await second).toMatchObject({ error: { code: "discount_refused", reason: "used_up" } });
    expect(await testDb.discountRedemption.count()).toBe(1);
  });

  it("lets exactly one take the last use for one email", async () => {
    const code = await createCode({ perCustomerLimit: 1 });
    const other = await createOrder({ email: "a@example.com" });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);
    const race = holding(
      (tx) => lockCode(tx, { id: code.id }),
      (tx) => redeem(tx, { codeId: code.id, orderId: other.id, email: "a@example.com" }),
    );
    await race.locked;

    const second = pay("SUMMER10", "a@example.com");
    await new Promise((resolve) => setTimeout(resolve, 200));
    race.release();
    await race.done;

    expect(await second).toMatchObject({ error: { reason: "customer_limit" } });
    expect(await testDb.discountRedemption.count()).toBe(1);
  });
});

describe("Apply (AC-1, AC-3, AC-17)", () => {
  it("answers the totals with the code, delivery recomputed on what is left", async () => {
    await createCode();
    await testDb.storeSettings.update({
      where: { id: 1 },
      data: { flatShippingCents: 1500, freeShippingThresholdCents: 5000 },
    });
    await cartWith([{ priceCents: 3000, quantity: 1 }]);

    expect(await applyDiscountCode({ code: " summer10" })).toEqual({
      ok: true,
      data: { code: "SUMMER10", discountCents: 300, shippingCents: 1500, totalCents: 4200 },
    });
  });

  it("refuses with the reason only, never the code's limits, counts or note", async () => {
    const code = await createCode({ maxRedemptions: 1 });
    await testDb.discountCode.update({ where: { id: code.id }, data: { note: "staff only" } });
    await usedBy(code.id);
    await cartWith([{ priceCents: 5000, quantity: 1 }]);

    const result = await applyDiscountCode({ code: "SUMMER10" });

    expect(result).toEqual({ ok: false, error: { code: "discount_refused", reason: "used_up" } });
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "checkout.discount_refused", stage: "apply" }),
      "checkout.discount_refused",
    );
  });

  it("checks the per customer limit only once the email is known", async () => {
    const code = await createCode({ perCustomerLimit: 1 });
    await usedBy(code.id, { email: "a@example.com" });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);

    expect((await applyDiscountCode({ code: "SUMMER10" })).ok).toBe(true);
    expect((await applyDiscountCode({ code: "SUMMER10", email: "not an email" })).ok).toBe(true);
    expect(await applyDiscountCode({ code: "SUMMER10", email: "A@example.com" })).toMatchObject({
      error: { reason: "customer_limit" },
    });

    mocks.customer = { id: (await createCustomer("a@example.com")).id, email: "a@example.com" };
    expect(await applyDiscountCode({ code: "SUMMER10", email: "x@example.com" })).toMatchObject({
      error: { reason: "customer_limit" },
    });
  });

  it("answers below_minimum first, and cart_changed without a cart", async () => {
    await cartWith([{ priceCents: 40, quantity: 1 }]);
    expect(await applyDiscountCode({ code: "NOPE" })).toEqual({
      ok: false,
      error: { code: "below_minimum", minimumCents: 50 },
    });

    mocks.jar.clear();
    expect(await applyDiscountCode({ code: "NOPE" })).toEqual({
      ok: false,
      error: { code: "cart_changed" },
    });
  });

  it("answers merged when a signed in customer's guest cart still waits to join", async () => {
    const customer = await createCustomer("c@example.com");
    const { variant } = await createSimpleProduct("acct", 5);
    await testDb.cart.create({
      data: {
        customerId: customer.id,
        expiresAt: inThirtyDays(),
        items: { create: { variantId: variant.id, quantity: 1 } },
      },
    });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);
    mocks.customer = { id: customer.id, email: customer.email };

    expect(await applyDiscountCode({ code: "NOPE" })).toEqual({
      ok: false,
      error: { code: "cart_changed", merged: true },
    });
  });
});

describe("Pay reads every value again from the database (value sourcing)", () => {
  it("discounts the price the variant has at Pay, not the one shown at Apply", async () => {
    await createCode();
    const cart = await cartWith([{ priceCents: 5000, quantity: 1 }]);
    expect(await applyDiscountCode({ code: "SUMMER10" })).toMatchObject({
      data: { discountCents: 500, totalCents: 4500 },
    });
    const [item] = await testDb.cartItem.findMany({ where: { cartId: cart.id } });
    await testDb.productVariant.update({
      where: { id: item!.variantId },
      data: { priceCents: 8000 },
    });

    expect((await pay("SUMMER10")).ok).toBe(true);

    expect(await testDb.order.findFirstOrThrow()).toMatchObject({
      subtotalCents: 8000,
      discountCents: 800,
      totalCents: 7200,
    });
    const [params] = mocks.create.mock.calls[0]!;
    expect(params.line_items[0].price_data.unit_amount).toBe(8000);
  });

  it("charges the delivery fee set after Apply", async () => {
    await createCode({ type: "fixed_amount", value: 500 });
    await cartWith([{ priceCents: 3000, quantity: 1 }]);
    expect(await applyDiscountCode({ code: "SUMMER10" })).toMatchObject({
      data: { shippingCents: 0, totalCents: 2500 },
    });
    await testDb.storeSettings.update({ where: { id: 1 }, data: { flatShippingCents: 1200 } });

    expect((await pay("SUMMER10")).ok).toBe(true);

    expect(await testDb.order.findFirstOrThrow()).toMatchObject({
      discountCents: 500,
      shippingCents: 1200,
      totalCents: 3700,
    });
  });

  it("checks and records the account email on a signed in Pay, whatever was typed", async () => {
    const code = await createCode({ code: "MINE", perCustomerLimit: 1 });
    const fresh = await createCode({ code: "FRESH", perCustomerLimit: 1 });
    const customer = await createCustomer("acct@example.com");
    await usedBy(code.id, { email: "acct@example.com" });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);
    mocks.customer = { id: customer.id, email: customer.email };

    expect(await pay("MINE", "someone-else@example.com")).toMatchObject({
      error: { code: "discount_refused", reason: "customer_limit" },
    });
    expect((await pay("FRESH", "someone-else@example.com")).ok).toBe(true);
    expect(
      await testDb.discountRedemption.findFirstOrThrow({ where: { discountCodeId: fresh.id } }),
    ).toMatchObject({ email: "acct@example.com" });
  });

  it("lets the database clock, not the server clock, decide a code has expired", async () => {
    await createCode({ endsAt: minutesAgo(1) });
    await cartWith([{ priceCents: 5000, quantity: 1 }]);
    // The app server's clock runs an hour behind; by it the code would still be open.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(minutesAgo(60));
    try {
      expect(await applyDiscountCode({ code: "SUMMER10" })).toMatchObject({
        error: { code: "discount_refused", reason: "expired" },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("refunds use the discounted lines (AC-16)", () => {
  async function ledgerOf(orderId: string) {
    const order = await testDb.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { orderBy: { unitPriceCents: "desc" } } },
    });
    const ledger = {
      totalCents: order.totalCents,
      shippingCents: order.shippingCents,
      lines: order.lines.map(({ id, quantity, lineTotalCents }) => ({
        id,
        quantity,
        lineTotalCents,
      })),
      refunds: [],
    };
    return { order, ledger };
  }

  it("suggests exactly the total for every unit plus delivery, and per line from its share", async () => {
    await createCode({ type: "fixed_amount", value: 1001 });
    await testDb.storeSettings.update({ where: { id: 1 }, data: { flatShippingCents: 1500 } });
    await cartWith([
      { priceCents: 3000, quantity: 1 },
      { priceCents: 1000, quantity: 3 },
    ]);
    await pay("SUMMER10");
    const { order, ledger } = await ledgerOf((await testDb.order.findFirstOrThrow()).id);
    const all = ledger.lines.map((line) => ({ orderLineId: line.id, quantity: line.quantity }));

    expect(suggestedCents(ledger, all, true)).toBe(order.totalCents);
    expect(order.totalCents).toBe(6000 - 1001 + 1500);
    // Two lines worth 3000 each split 1001 as 501 and 500: the tie goes to the first cart line.
    const [first, second] = order.lines;
    expect([first?.discountCents, second?.discountCents]).toEqual([501, 500]);
    expect(suggestedCents(ledger, [{ orderLineId: first!.id, quantity: 1 }], false)).toBe(
      first!.lineTotalCents,
    );
  });

  it("leaves only delivery to refund on a 100% code", async () => {
    await createCode({ value: 100 });
    await testDb.storeSettings.update({ where: { id: 1 }, data: { flatShippingCents: 1500 } });
    await cartWith([{ priceCents: 2000, quantity: 2 }]);
    await pay("SUMMER10");
    const { order, ledger } = await ledgerOf((await testDb.order.findFirstOrThrow()).id);

    expect(order).toMatchObject({ discountCents: 4000, shippingCents: 1500, totalCents: 1500 });
    expect(order.lines[0]?.lineTotalCents).toBe(0);
    expect(suggestedCents(ledger, [{ orderLineId: order.lines[0]!.id, quantity: 2 }], true)).toBe(
      1500,
    );
  });
});
