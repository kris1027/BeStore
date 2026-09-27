import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import {
  eventsOf,
  offlineStripe,
  seedPendingOrder,
  sessionEvent,
  signedRequest,
  stock,
} from "./stripe-support";

// POST /api/stripe/webhook against a real Postgres, with events signed like Stripe signs them
// (spec 0006, AC-3 to AC-8 and AC-16).

const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  failNextPaid: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: { STRIPE_WEBHOOK_SECRET: "whsec_test_secret", STRIPE_SECRET_KEY: "sk_test_offline" },
}));
vi.mock("@/lib/stripe", async () => ({
  stripe: { webhooks: (await import("./stripe-support")).offlineStripe.webhooks },
}));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: mocks.error },
}));
vi.mock("@/lib/orders/transitions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/orders/transitions")>();
  return {
    ...original,
    markPaid: async (...args: Parameters<typeof original.markPaid>) => {
      if (mocks.failNextPaid) {
        mocks.failNextPaid = false;
        await original.markPaid(...args);
        throw new Error("boom after the writes");
      }
      return original.markPaid(...args);
    },
  };
});

const { stripeWebhookRequest } = await import("@/features/orders/webhook");

resetDatabaseBeforeEach();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.failNextPaid = false;
});

async function post(event: Parameters<typeof signedRequest>[0]) {
  const response = await stripeWebhookRequest(signedRequest(event));
  return { status: response.status, body: (await response.json()) as { result?: string } };
}

describe("signature", () => {
  it("answers 400 without a signature and changes nothing", async () => {
    const { order } = await seedPendingOrder();
    const event = sessionEvent("checkout.session.completed", { orderId: order.id });

    const response = await stripeWebhookRequest(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );

    expect(response.status).toBe(400);
    expect(await testDb.stripeEvent.count()).toBe(0);
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      { event: "stripe.webhook.invalid_signature" },
      "stripe.webhook.invalid_signature",
    );
  });

  it("answers 400 for a wrong secret or a changed body", async () => {
    const { order } = await seedPendingOrder();
    const event = sessionEvent("checkout.session.completed", { orderId: order.id });

    const wrongSecret = await stripeWebhookRequest(signedRequest(event, "whsec_other"));
    const signed = signedRequest(event);
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify({ ...event, id: "evt_forged" }),
    });
    const changedBody = await stripeWebhookRequest(tampered);

    expect(wrongSecret.status).toBe(400);
    expect(changedBody.status).toBe(400);
    expect(await testDb.stripeEvent.count()).toBe(0);
  });
});

describe("a paid event", () => {
  it("marks the order paid, takes the stock, deletes the cart and expires the tags", async () => {
    const { order, variant, product, cart } = await seedPendingOrder({ stock: 5, quantity: 2 });
    const created = Math.floor(Date.UTC(2026, 8, 27, 10, 0, 0) / 1000);
    const event = sessionEvent("checkout.session.completed", {
      orderId: order.id,
      created,
      paymentIntent: "pi_test_42",
    });

    const response = await post(event);

    expect(response).toEqual({ status: 200, body: { received: true, result: "paid" } });
    const paid = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid).toMatchObject({
      status: "paid",
      paidAt: new Date(created * 1000),
      stripePaymentIntentId: "pi_test_42",
      needsAttention: false,
      cartId: null,
    });
    expect(await stock(variant.id)).toBe(3);
    expect(await testDb.cart.findUnique({ where: { id: cart.id } })).toBeNull();
    expect(await testDb.stripeEvent.findUnique({ where: { id: event.id } })).toMatchObject({
      type: "checkout.session.completed",
    });
    const events = await eventsOf(order.id);
    expect(events.map((e) => [e.type, e.fromStatus, e.toStatus, e.actorType])).toEqual([
      ["created", null, "pending_payment", "customer"],
      ["status_changed", "pending_payment", "paid", "system"],
    ]);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("catalog", { expire: 0 });
    expect(mocks.revalidateTag).toHaveBeenCalledWith(`product:${product.slug}`, { expire: 0 });
  });

  it("applies once however often it arrives, and a second paid event changes nothing", async () => {
    const { order, variant } = await seedPendingOrder({ stock: 5, quantity: 2 });
    const completed = sessionEvent("checkout.session.completed", { orderId: order.id });

    const first = await post(completed);
    const again = await post(completed);
    const succeeded = await post(
      sessionEvent("checkout.session.async_payment_succeeded", { orderId: order.id }),
    );

    expect([first.body.result, again.body.result, succeeded.body.result]).toEqual([
      "paid",
      "duplicate",
      "stale",
    ]);
    expect(await stock(variant.id)).toBe(3);
    const changes = (await eventsOf(order.id)).filter((e) => e.type === "status_changed");
    expect(changes).toHaveLength(1);
    expect(await testDb.stripeEvent.count()).toBe(2);
  });

  it("pays on async_payment_succeeded after a completed but unpaid event", async () => {
    const { order, variant } = await seedPendingOrder({ stock: 5, quantity: 1 });

    const waiting = await post(
      sessionEvent("checkout.session.completed", { orderId: order.id, paymentStatus: "unpaid" }),
    );
    expect(waiting.body.result).toBe("processing");
    expect(await stock(variant.id)).toBe(5);
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );

    const paid = await post(
      sessionEvent("checkout.session.async_payment_succeeded", { orderId: order.id }),
    );
    expect(paid.body.result).toBe("paid");
    expect(await stock(variant.id)).toBe(4);
  });
});

describe("failed and abandoned payments", () => {
  it.each([
    ["checkout.session.async_payment_failed", "Payment failed"],
    ["checkout.session.expired", "Checkout session expired"],
  ])("%s sets the order expired and leaves stock alone", async (type, message) => {
    const { order, variant, cart } = await seedPendingOrder({ stock: 5 });

    const response = await post(sessionEvent(type, { orderId: order.id, paymentStatus: "unpaid" }));

    expect(response.body.result).toBe("expired");
    const expired = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(expired.status).toBe("expired");
    expect(expired.expiredAt).not.toBeNull();
    expect(await stock(variant.id)).toBe(5);
    expect(await testDb.cart.findUnique({ where: { id: cart.id } })).not.toBeNull();
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: "status_changed",
      toStatus: "expired",
      actorType: "system",
      message,
    });
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it("never lets a late paid event revive an expired order", async () => {
    const { order, variant } = await seedPendingOrder({ stock: 5 });
    await post(sessionEvent("checkout.session.expired", { orderId: order.id }));

    const late = await post(sessionEvent("checkout.session.completed", { orderId: order.id }));

    expect(late.body.result).toBe("stale");
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "expired",
    );
    expect(await stock(variant.id)).toBe(5);
  });
});

describe("shortfalls and mismatches", () => {
  it("takes what stock there is and flags the missing units", async () => {
    const { order, variant } = await seedPendingOrder({ stock: 2, quantity: 3, priceCents: 1000 });

    await post(
      sessionEvent("checkout.session.completed", { orderId: order.id, amountTotal: 3000 }),
    );

    expect(await stock(variant.id)).toBe(0);
    const paid = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid).toMatchObject({ status: "paid", needsAttention: true });
    const shortfalls = (await eventsOf(order.id)).filter((e) => e.type === "stock_shortfall");
    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0]?.message).toContain(`${variant.sku} short by 1`);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "order.stock_shortfall",
        skus: [{ sku: variant.sku, missing: 1 }],
      }),
      "order.stock_shortfall",
    );
  });

  it("counts a line whose variant was deleted as short by its whole quantity", async () => {
    const { order, variant } = await seedPendingOrder({ quantity: 2 });
    await testDb.productVariant.delete({ where: { id: variant.id } });

    await post(sessionEvent("checkout.session.completed", { orderId: order.id }));

    const shortfall = (await eventsOf(order.id)).find((e) => e.type === "stock_shortfall");
    expect(shortfall?.message).toContain(`${variant.sku} short by 2`);
  });

  it("still pays when Stripe charged a different amount or currency, and flags it", async () => {
    const { order } = await seedPendingOrder({ quantity: 2, priceCents: 2500 });

    await post(
      sessionEvent("checkout.session.completed", {
        orderId: order.id,
        amountTotal: 4999,
        currency: "usd",
      }),
    );

    expect(await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "paid",
      needsAttention: true,
    });
    const note = (await eventsOf(order.id)).find((e) => e.type === "note");
    expect(note?.message).toContain("4999 USD");
    expect(note?.message).toContain("5000 EUR");
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "order.amount_mismatch",
        expectedCents: 5000,
        receivedCents: 4999,
      }),
      "order.amount_mismatch",
    );
  });

  it("sells the last unit once when two paid orders race for it", async () => {
    const first = await seedPendingOrder({ suffix: "a", stock: 1, quantity: 1 });
    const second = await testDb.order.create({
      data: {
        email: "b@example.com",
        currency: "EUR",
        subtotalCents: 2500,
        totalCents: 2500,
        lines: {
          create: {
            variantId: first.variant.id,
            productId: first.product.id,
            productName: first.product.name,
            sku: first.variant.sku,
            unitPriceCents: 2500,
            quantity: 1,
            lineTotalCents: 2500,
          },
        },
      },
    });

    const results = await Promise.all(
      [first.order.id, second.id].map((orderId, index) =>
        post(
          sessionEvent("checkout.session.completed", {
            orderId,
            amountTotal: 2500,
            paymentIntent: `pi_test_race${index}`,
          }),
        ),
      ),
    );

    expect(results.map((r) => r.body.result)).toEqual(["paid", "paid"]);

    expect(await stock(first.variant.id)).toBe(0);
    expect(await testDb.order.count({ where: { status: "paid" } })).toBe(2);
    expect(await testDb.orderEvent.count({ where: { type: "stock_shortfall" } })).toBe(1);
  });
});

describe("events that change nothing", () => {
  it.each([
    ["no order id in the metadata", null],
    ["an order id that is not a uuid", "1001"],
    ["an unknown order", "0192f1c2-0000-7000-8000-000000000999"],
  ])("answers 200 not_ours for %s and records it", async (_, orderId) => {
    const event = sessionEvent("checkout.session.completed", { orderId });

    const response = await post(event);

    expect(response).toEqual({ status: 200, body: { received: true, result: "not_ours" } });
    expect(await testDb.stripeEvent.findUnique({ where: { id: event.id } })).not.toBeNull();
  });

  it("records an event type the store does not handle and ignores it", async () => {
    const { order } = await seedPendingOrder();
    const event = sessionEvent("payment_intent.succeeded", { orderId: order.id });

    const response = await post(event);

    expect(response.body.result).toBe("ignored");
    expect(await testDb.stripeEvent.count()).toBe(1);
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
  });

  it("answers 500 and rolls everything back when processing throws, so a retry applies it", async () => {
    const { order, variant } = await seedPendingOrder({ stock: 5, quantity: 2 });
    const event = sessionEvent("checkout.session.completed", { orderId: order.id });
    mocks.failNextPaid = true;

    const failed = await stripeWebhookRequest(signedRequest(event));

    expect(failed.status).toBe(500);
    expect(await testDb.stripeEvent.count()).toBe(0);
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
    expect(await stock(variant.id)).toBe(5);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "stripe.event.failed", eventId: event.id }),
      "stripe.event.failed",
    );

    const retried = await post(event);
    expect(retried.body.result).toBe("paid");
    expect(await stock(variant.id)).toBe(3);
  });
});

describe("logs", () => {
  it("never carry the customer's email", async () => {
    const { order } = await seedPendingOrder();
    await post(sessionEvent("checkout.session.completed", { orderId: order.id }));

    const lines = JSON.stringify([
      ...mocks.info.mock.calls,
      ...mocks.warn.mock.calls,
      ...mocks.error.mock.calls,
    ]);
    expect(lines).not.toContain("ada@example.com");
    expect(lines).toContain('"event":"order.paid"');
    expect(lines).toContain('"event":"stripe.event.processed"');
  });
});

// Keeps the offline client honest: it signs, it never calls the API.
it("uses an offline Stripe client", () => {
  expect(offlineStripe.webhooks.generateTestHeaderString).toBeTypeOf("function");
});
