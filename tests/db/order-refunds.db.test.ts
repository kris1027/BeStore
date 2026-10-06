import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createAdmin } from "./fixtures";
import {
  orderOf,
  orderRef,
  refundEvent,
  refundsOf,
  returnsOf,
  seedPaidOrder,
  stripeRefund,
} from "./order-support";
import { autoPaging, eventsOf, signedRequest, stock } from "./stripe-support";

// Refunds, cancel, refund webhooks and the refund sync against a real Postgres, with Stripe's
// API stubbed at the edge (spec 0010, AC-9 to AC-18, AC-22, AC-23).

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  list: vi.fn(),
  sessionRetrieve: vi.fn(),
  sessionExpire: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: {
    STORE_LOCALE: "en",
    STORE_TIMEZONE: "Europe/Warsaw",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    CRON_SECRET: "s".repeat(32),
  },
}));
vi.mock("@/lib/stripe", async () => ({
  stripe: {
    refunds: { create: mocks.create, retrieve: mocks.retrieve, list: mocks.list },
    checkout: { sessions: { retrieve: mocks.sessionRetrieve, expire: mocks.sessionExpire } },
    events: { list: () => autoPaging([]) },
    webhooks: (await import("./stripe-support")).offlineStripe.webhooks,
  },
  stripeDashboardUrl: () => "https://dashboard",
}));
vi.mock("next/cache", () => ({
  updateTag: mocks.updateTag,
  revalidatePath: vi.fn(),
  revalidateTag: mocks.revalidateTag,
}));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/logger", async (importOriginal) =>
  (await import("./logger-mock")).mockLoggerModule(importOriginal, {
    info: mocks.info,
    warn: mocks.warn,
    error: mocks.error,
  }),
);

const { cancelOrder, checkRefundWithStripe, refundOrder } =
  await import("@/features/orders/admin-actions");
const { stripeWebhookRequest } = await import("@/features/orders/webhook");
const { reconcileOrdersRequest } = await import("@/features/orders/reconcile");
const { syncRefund } = await import("@/features/orders/refund-sync");

resetDatabaseBeforeEach();

let adminId = "";

beforeEach(async () => {
  vi.clearAllMocks();
  adminId = (await createAdmin()).id;
  mocks.requireAdmin.mockResolvedValue({ id: adminId, email: "admin@example.com", name: "Admin" });
  mocks.list.mockReturnValue(autoPaging([]));
});

// Stripe answers what it was asked, with this status.
function stripeAnswers(status: string, extra: Parameters<typeof stripeRefund>[0] = {}) {
  mocks.create.mockImplementation(
    async (params: { amount: number; metadata: { refund_id: string } }) =>
      stripeRefund({
        status,
        amount: params.amount,
        refundId: params.metadata.refund_id,
        ...extra,
      }),
  );
}

function stripeError(type: string, message = "Charge already refunded") {
  return Object.assign(new Error(message), { type, code: "charge_already_refunded" });
}

async function post(event: Parameters<typeof signedRequest>[0]) {
  const response = await stripeWebhookRequest(signedRequest(event));
  return { status: response.status, body: (await response.json()) as { result?: string } };
}

// 2 units at 25.00 (5000), stock 5 before the sale (3 after).
async function paidOrder(options: Parameters<typeof seedPaidOrder>[0] = {}) {
  const seeded = await seedPaidOrder({ stock: 5, quantity: 2, ...options });
  const line = await testDb.orderLine.findFirstOrThrow({ where: { orderId: seeded.order.id } });
  return { ...seeded, line };
}

describe("refundOrder (AC-9 to AC-13)", () => {
  it("refunds 1 of 2 units with restock: counted, back in stock, cache expired", async () => {
    const { order, line, variant } = await paidOrder();
    stripeAnswers("succeeded");

    const result = await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 1, restock: true }],
      refundShipping: false,
      amount: "25.00",
      reason: "Too small, sent back",
    });

    expect(result).toMatchObject({ ok: true, data: { status: "succeeded" } });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: "pi_test_1",
        amount: 2500,
        reason: "requested_by_customer",
        metadata: expect.objectContaining({ order_number: "1001" }),
      }),
      { idempotencyKey: expect.any(String) },
    );
    // Stripe never gets the reason.
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain("Too small");
    expect((await orderOf()).refundedCents).toBe(2500);
    const [refund] = await refundsOf(order.id);
    expect(refund).toMatchObject({ status: "succeeded", amountCents: 2500, adminId });
    expect(refund?.succeededAt).not.toBeNull();
    expect(refund?.lines).toEqual([
      expect.objectContaining({ quantity: 1, restock: true, restocked: true, returnedQuantity: 1 }),
    ]);
    expect(await stock(variant.id)).toBe(4);
    expect(await returnsOf(order.id)).toEqual([
      { variantId: variant.id, delta: 1, stockAfter: 4, adminId, actorType: "admin" },
    ]);
    expect(mocks.updateTag.mock.calls.map(([tag]) => tag)).toEqual(["catalog", "product:tee-1"]);
    expect((await eventsOf(order.id)).map((event) => event.type).slice(-2)).toEqual([
      "refund_created",
      "refund_succeeded",
    ]);
    // AC-23: never the reason.
    const logged = JSON.stringify([mocks.info.mock.calls, mocks.warn.mock.calls]);
    expect(logged).toContain("refund.created");
    expect(logged).not.toContain("Too small");
    expect(logged).not.toContain("ada@example.com");
  });

  it("leaves a refund pending when Stripe says pending, and does not restock yet", async () => {
    const { order, line, variant } = await paidOrder();
    stripeAnswers("pending");

    const result = await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 2, restock: true }],
      refundShipping: false,
      amount: "50",
      reason: "Return",
    });

    expect(result).toMatchObject({ ok: true, data: { status: "pending" } });
    const [refund] = await refundsOf(order.id);
    expect(refund).toMatchObject({
      status: "pending",
      stripeRefundId: expect.stringMatching(/^re_/),
    });
    expect((await orderOf()).refundedCents).toBe(0);
    expect(await stock(variant.id)).toBe(3);
  });

  it("marks the refund failed and changes nothing else when Stripe refuses (AC-12)", async () => {
    const { order, line } = await paidOrder();
    mocks.create.mockRejectedValue(stripeError("StripeInvalidRequestError"));

    const result = await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 1, restock: false }],
      refundShipping: false,
      amount: "10",
      reason: "Goodwill",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "stripe_refused", message: "Charge already refunded" },
    });
    const [refund] = await refundsOf(order.id);
    expect(refund?.status).toBe("failed");
    expect(await orderOf()).toMatchObject({ refundedCents: 0, needsAttention: false });
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: "refund_failed",
      message: "Refund of €10.00 failed: Charge already refunded",
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "refund.stripe_refused",
        stripeCode: "charge_already_refunded",
      }),
      "refund.stripe_refused",
    );
  });

  it.each(["StripeAPIError", "StripeConnectionError", "StripeRateLimitError"])(
    "keeps the refund pending and in flight on %s",
    async (type) => {
      const { order, line } = await paidOrder();
      mocks.create.mockRejectedValue(stripeError(type, "boom"));

      const result = await refundOrder({
        ...(await orderRef()),
        lines: [{ orderLineId: line.id, quantity: 1, restock: false }],
        refundShipping: false,
        amount: "10",
        reason: "x",
      });

      expect(result).toEqual({
        ok: false,
        error: { code: "stripe_unavailable", refundPending: true },
      });
      expect((await refundsOf(order.id))[0]).toMatchObject({
        status: "pending",
        stripeRefundId: null,
      });
      // AC-18: the next refund is refused while the first may still land.
      expect(
        await refundOrder({
          ...(await orderRef()),
          lines: [],
          refundShipping: false,
          amount: "1",
          reason: "again",
        }),
      ).toEqual({ ok: false, error: { code: "refund_in_progress" } });
    },
  );

  it("refuses amounts outside the caps and never calls Stripe (AC-11)", async () => {
    const { line } = await paidOrder();
    const base = {
      lines: [{ orderLineId: line.id, quantity: 1, restock: false }],
      refundShipping: false,
      reason: "x",
    };

    expect(await refundOrder({ ...(await orderRef()), ...base, amount: "25.01" })).toMatchObject({
      ok: false,
      error: { code: "invalid_input", fields: { amount: [expect.any(String)] } },
    });
    expect(await refundOrder({ ...(await orderRef()), ...base, amount: "0" })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(
      await refundOrder({
        ...(await orderRef()),
        ...base,
        lines: [{ orderLineId: line.id, quantity: 3, restock: false }],
        amount: "1",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input", fields: { [`lines.${line.id}`]: [expect.any(String)] } },
    });
    expect(
      await refundOrder({
        ...(await orderRef()),
        lines: [],
        refundShipping: false,
        amount: "50.01",
        reason: "x",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("lets only one of two concurrent full refunds reach Stripe (AC-8, AC-11)", async () => {
    await paidOrder();
    stripeAnswers("succeeded");
    const ref = await orderRef();
    const full = { ...ref, lines: [], refundShipping: false, amount: "50", reason: "x" };

    const results = await Promise.all([refundOrder(full), refundOrder(full)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, error: { code: "stale" } });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect((await orderOf()).refundedCents).toBe(5000);
  });

  it("returns only what the sale took on a shortfall line, with a note (AC-13)", async () => {
    // Stock 1, 2 bought: the sale took 1.
    const { order, line, variant } = await paidOrder({ stock: 1 });
    stripeAnswers("succeeded");

    await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 2, restock: true }],
      refundShipping: false,
      amount: "50",
      reason: "Could not ship",
    });

    expect(await stock(variant.id)).toBe(1);
    expect((await refundsOf(order.id))[0]?.lines[0]).toMatchObject({
      returnedQuantity: 1,
      restocked: true,
    });
    expect((await eventsOf(order.id)).map((event) => event.message)).toContain(
      `Returned 1 of 2 to stock for ${variant.sku}`,
    );
  });

  it("refunds delivery once", async () => {
    const { line } = await paidOrder({ shippingCents: 500 });
    stripeAnswers("succeeded");

    const first = await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 1, restock: false }],
      refundShipping: true,
      amount: "30",
      reason: "x",
    });
    expect(first).toMatchObject({ ok: true });
    expect(
      await refundOrder({
        ...(await orderRef()),
        lines: [],
        refundShipping: true,
        amount: "5",
        reason: "x",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input", fields: { refundShipping: [expect.any(String)] } },
    });
  });
});

describe("cancelOrder (AC-14, AC-15)", () => {
  it("cancels a paid order and refunds the rest, restocking the ticked lines", async () => {
    const { order, line, variant } = await paidOrder();
    stripeAnswers("succeeded");

    const result = await cancelOrder({
      ...(await orderRef()),
      reason: "Customer changed their mind",
      restockLineIds: [line.id],
    });

    expect(result).toMatchObject({ ok: true, data: { status: "cancelled" } });
    expect(await orderOf()).toMatchObject({ status: "cancelled", refundedCents: 5000 });
    const [refund] = await refundsOf(order.id);
    expect(refund).toMatchObject({ amountCents: 5000, status: "succeeded" });
    expect(refund?.lines).toEqual([
      expect.objectContaining({ quantity: 2, restock: true, returnedQuantity: 2 }),
    ]);
    expect(await stock(variant.id)).toBe(5);
  });

  it("puts the order back to paid when Stripe refuses the refund", async () => {
    const { order, line } = await paidOrder();
    mocks.create.mockRejectedValue(stripeError("StripeInvalidRequestError", "Nope"));

    const result = await cancelOrder({
      ...(await orderRef()),
      reason: "x",
      restockLineIds: [line.id],
    });

    expect(result).toEqual({ ok: false, error: { code: "stripe_refused", message: "Nope" } });
    expect(await orderOf()).toMatchObject({ status: "paid", cancelledAt: null });
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: "status_changed",
      fromStatus: "cancelled",
      toStatus: "paid",
      message: "Cancel undone: Stripe refused the refund",
    });
  });

  it("stays cancelled with a pending refund when Stripe does not answer", async () => {
    const { order } = await paidOrder();
    mocks.create.mockRejectedValue(stripeError("StripeConnectionError"));

    await cancelOrder({ ...(await orderRef()), reason: "x", restockLineIds: [] });

    expect((await orderOf()).status).toBe("cancelled");
    expect((await refundsOf(order.id))[0]?.status).toBe("pending");
  });

  it("cancels without Stripe when nothing is left to refund", async () => {
    const { order } = await paidOrder();
    await testDb.refund.create({
      data: {
        orderId: order.id,
        amountCents: 5000,
        status: "succeeded",
        succeededAt: new Date(),
        actorType: "system",
        stripeRefundId: "re_x",
      },
    });

    expect(
      await cancelOrder({ ...(await orderRef()), reason: "x", restockLineIds: [] }),
    ).toMatchObject({
      ok: true,
      data: { status: "cancelled", refundId: null },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("expires an open session, then cancels the pending order", async () => {
    const { seedPendingOrder } = await import("./stripe-support");
    await seedPendingOrder();
    mocks.sessionRetrieve.mockResolvedValue({ status: "open", payment_status: "unpaid" });
    mocks.sessionExpire.mockResolvedValue({});

    expect(
      await cancelOrder({ ...(await orderRef()), reason: "Duplicate", restockLineIds: [] }),
    ).toMatchObject({
      ok: true,
      data: { status: "cancelled" },
    });
    expect(mocks.sessionExpire).toHaveBeenCalledWith("cs_test_session1");
    expect((await orderOf()).status).toBe("cancelled");
  });

  it("refunds a payment that lands after the pending order was cancelled (AC-15)", async () => {
    const { seedPendingOrder, sessionEvent } = await import("./stripe-support");
    const { order } = await seedPendingOrder();
    mocks.sessionRetrieve.mockResolvedValue({ status: "open", payment_status: "unpaid" });
    mocks.sessionExpire.mockResolvedValue({});
    await cancelOrder({ ...(await orderRef()), reason: "Duplicate", restockLineIds: [] });
    expect(
      (await post(sessionEvent("checkout.session.completed", { orderId: order.id }))).body.result,
    ).toBe("late_payment");
    stripeAnswers("succeeded");

    const total = (await orderOf()).totalCents;
    const result = await refundOrder({
      ...(await orderRef()),
      lines: [],
      refundShipping: false,
      amount: (total / 100).toFixed(2),
      reason: "Paid after cancel",
    });

    expect(result).toMatchObject({ ok: true, data: { status: "succeeded" } });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_test_1", amount: total }),
      { idempotencyKey: expect.any(String) },
    );
    expect(await orderOf()).toMatchObject({ status: "cancelled", refundedCents: total });
  });

  it.each([
    ["paid", { status: "complete", payment_status: "paid" }],
    ["processing", { status: "complete", payment_status: "unpaid" }],
  ])("refuses a pending order whose session is %s", async (_name, session) => {
    const { seedPendingOrder } = await import("./stripe-support");
    await seedPendingOrder();
    mocks.sessionRetrieve.mockResolvedValue(session);

    expect(await cancelOrder({ ...(await orderRef()), reason: "x", restockLineIds: [] })).toEqual({
      ok: false,
      error: { code: "payment_in_progress" },
    });
    expect((await orderOf()).status).toBe("pending_payment");
  });

  it("refuses when expiring fails and the session is still open, and when Stripe is down", async () => {
    const { seedPendingOrder } = await import("./stripe-support");
    await seedPendingOrder();
    mocks.sessionRetrieve.mockResolvedValue({ status: "open", payment_status: "unpaid" });
    mocks.sessionExpire.mockRejectedValue(new Error("nope"));
    expect(await cancelOrder({ ...(await orderRef()), reason: "x", restockLineIds: [] })).toEqual({
      ok: false,
      error: { code: "payment_in_progress" },
    });

    mocks.sessionRetrieve.mockRejectedValue(new Error("down"));
    expect(await cancelOrder({ ...(await orderRef()), reason: "x", restockLineIds: [] })).toEqual({
      ok: false,
      error: { code: "stripe_unavailable", refundPending: false },
    });
    expect((await orderOf()).status).toBe("pending_payment");
  });
});

describe("refund webhooks (AC-16, AC-17)", () => {
  it("counts a refund once when the webhook lands before the action settles it", async () => {
    const { order, line, variant } = await paidOrder();
    mocks.create.mockImplementation(
      async (params: { amount: number; metadata: { refund_id: string } }) => {
        const refund = stripeRefund({
          id: "re_race",
          status: "succeeded",
          amount: params.amount,
          refundId: params.metadata.refund_id,
        });
        expect((await post(refundEvent("refund.updated", refund))).body.result).toBe("refund");
        return refund;
      },
    );

    await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 1, restock: true }],
      refundShipping: false,
      amount: "25",
      reason: "x",
    });

    expect((await orderOf()).refundedCents).toBe(2500);
    expect(await stock(variant.id)).toBe(4);
    expect(await returnsOf(order.id)).toHaveLength(1);
    expect(
      (await eventsOf(order.id)).filter((event) => event.type === "refund_succeeded"),
    ).toHaveLength(1);
  });

  it("records a dashboard refund once, and counts it once it succeeds", async () => {
    const { order } = await paidOrder();
    const created = stripeRefund({
      id: "re_dash",
      status: "pending",
      amount: 1000,
      refundId: null,
    });
    const succeeded = stripeRefund({
      id: "re_dash",
      status: "succeeded",
      amount: 1000,
      refundId: null,
    });

    await post(refundEvent("refund.created", created));
    await post(refundEvent("refund.updated", succeeded, "evt_dash_succeeded"));
    await post(refundEvent("refund.updated", succeeded, "evt_dash_succeeded"));

    const refunds = await refundsOf(order.id);
    expect(refunds).toEqual([
      expect.objectContaining({
        actorType: "system",
        adminId: null,
        amountCents: 1000,
        status: "succeeded",
        lines: [],
      }),
    ]);
    expect((await orderOf()).refundedCents).toBe(1000);
  });

  it("answers 200 and changes nothing for a payment that is not ours", async () => {
    await paidOrder();
    const foreign = stripeRefund({ paymentIntent: "pi_someone_else", refundId: null });

    expect(await post(refundEvent("refund.created", foreign))).toEqual({
      status: 200,
      body: { received: true, result: "not_ours" },
    });
    expect(await testDb.refund.count()).toBe(0);
  });

  it("uncounts a succeeded refund that later fails, keeps the stock and flags the order", async () => {
    const { order, line, variant } = await paidOrder();
    stripeAnswers("succeeded", { id: "re_late" });
    await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 1, restock: true }],
      refundShipping: false,
      amount: "25",
      reason: "x",
    });

    await post(
      refundEvent(
        "refund.failed",
        stripeRefund({ id: "re_late", status: "failed", amount: 2500, refundId: null }),
      ),
    );

    expect(await orderOf()).toMatchObject({ refundedCents: 0, needsAttention: true });
    expect((await refundsOf(order.id))[0]).toMatchObject({ status: "failed", succeededAt: null });
    expect(await stock(variant.id)).toBe(4);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "refund.late_failure", from: "succeeded" }),
      "refund.late_failure",
    );
  });

  it("fails a pending refund without counting or restocking it, and flags a cancelled order", async () => {
    const { order, variant } = await paidOrder();
    stripeAnswers("pending", { id: "re_pend" });
    await cancelOrder({
      ...(await orderRef()),
      reason: "x",
      restockLineIds: [(await testDb.orderLine.findFirstOrThrow()).id],
    });

    await post(
      refundEvent(
        "refund.updated",
        stripeRefund({ id: "re_pend", status: "failed", amount: 5000, refundId: null }),
      ),
    );

    expect(await orderOf()).toMatchObject({
      status: "cancelled",
      refundedCents: 0,
      needsAttention: true,
    });
    expect(await stock(variant.id)).toBe(3);
    expect((await refundsOf(order.id))[0]?.status).toBe("failed");
  });

  it("caps refunded_cents at the total when refunds overflow it, and flags the order", async () => {
    const { order } = await paidOrder();
    // An admin refund for everything is pending at Stripe...
    stripeAnswers("pending", { id: "re_admin" });
    await refundOrder({
      ...(await orderRef()),
      lines: [],
      refundShipping: false,
      amount: "50",
      reason: "x",
    });
    // ...while someone refunds 10.00 in the dashboard, and then both succeed.
    await post(
      refundEvent(
        "refund.created",
        stripeRefund({ id: "re_dash", status: "succeeded", amount: 1000, refundId: null }),
      ),
    );
    const response = await post(
      refundEvent(
        "refund.updated",
        stripeRefund({ id: "re_admin", status: "succeeded", amount: 5000, refundId: null }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await orderOf()).toMatchObject({ refundedCents: 5000, needsAttention: true });
    expect((await refundsOf(order.id)).map((refund) => refund.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
  });

  it("flags a refund status newer than the pinned API version once, and keeps it pending", async () => {
    const { order } = await paidOrder();
    stripeAnswers("pending", { id: "re_new" });
    await refundOrder({
      ...(await orderRef()),
      lines: [],
      refundShipping: false,
      amount: "5",
      reason: "x",
    });
    const odd = stripeRefund({ id: "re_new", status: "reversed", amount: 500, refundId: null });

    await post(refundEvent("refund.updated", odd));
    await post(refundEvent("refund.updated", odd));

    expect((await orderOf()).needsAttention).toBe(true);
    expect((await refundsOf(order.id))[0]?.status).toBe("pending");
    expect(
      (await eventsOf(order.id)).filter((event) => event.message?.includes("reversed")),
    ).toHaveLength(1);
  });
});

describe("refund sync (AC-17)", () => {
  async function pendingWithoutId(createdAt: Date) {
    const { order, line } = await paidOrder();
    const refund = await testDb.refund.create({
      data: {
        orderId: order.id,
        amountCents: 2500,
        actorType: "admin",
        adminId,
        createdAt,
        lines: { create: { orderLineId: line.id, quantity: 1, restock: true } },
      },
    });
    return { order, refund };
  }

  it("finds a lost answer by our metadata and settles it, restocking", async () => {
    const { order, refund } = await pendingWithoutId(new Date(Date.now() - 60 * 60 * 1000));
    mocks.list.mockReturnValue(
      autoPaging([
        stripeRefund({ id: "re_other", refundId: "someone-else" }),
        stripeRefund({ id: "re_found", status: "succeeded", amount: 2500, refundId: refund.id }),
      ]),
    );

    const result = await syncRefund(refund.id, Date.now());

    expect(result?.status).toBe("succeeded");
    expect(mocks.list).toHaveBeenCalledWith({ payment_intent: "pi_test_1", limit: 100 });
    expect((await refundsOf(order.id))[0]).toMatchObject({
      stripeRefundId: "re_found",
      status: "succeeded",
    });
    expect(await returnsOf(order.id)).toHaveLength(1);
  });

  it("leaves an unfound refund pending until it is 24 hours old, then fails it", async () => {
    const young = await pendingWithoutId(new Date(Date.now() - 60 * 60 * 1000));
    expect((await syncRefund(young.refund.id, Date.now()))?.status).toBe("pending");

    const later = Date.now() + 24 * 60 * 60 * 1000;
    expect((await syncRefund(young.refund.id, later))?.status).toBe("failed");
    expect(await orderOf()).toMatchObject({ needsAttention: true, refundedCents: 0 });
    expect((await eventsOf(young.order.id)).at(-1)?.message).toBe(
      "Refund of €25.00 failed: Request never reached Stripe",
    );
  });

  it("retrieves a refund with a Stripe id; the cron counts it and isolates errors", async () => {
    const { order, line } = await paidOrder();
    await testDb.refund.create({
      data: {
        orderId: order.id,
        amountCents: 1000,
        actorType: "admin",
        adminId,
        stripeRefundId: "re_ok",
        createdAt: new Date(Date.now() - 1e6),
      },
    });
    await testDb.refund.create({
      data: {
        orderId: order.id,
        amountCents: 1000,
        actorType: "admin",
        adminId,
        stripeRefundId: "re_bad",
        lines: { create: { orderLineId: line.id, quantity: 1 } },
      },
    });
    mocks.retrieve.mockImplementation(async (id: string) => {
      if (id === "re_bad") throw new Error("Stripe down");
      return stripeRefund({ id, status: "succeeded", amount: 1000, refundId: null });
    });

    const response = await reconcileOrdersRequest(
      new Request("http://localhost/api/cron/reconcile-orders", {
        headers: { authorization: `Bearer ${"s".repeat(32)}` },
      }),
    );

    expect(await response.json()).toMatchObject({ refundsSynced: 1, refundsFailed: 1 });
    expect((await orderOf()).refundedCents).toBe(1000);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "cron.reconcile_refund_failed" }),
      "cron.reconcile_refund_failed",
    );
  });

  it("checks with Stripe from the order page only after 2 minutes", async () => {
    const { order } = await paidOrder();
    const refund = await testDb.refund.create({
      data: {
        orderId: order.id,
        amountCents: 1000,
        actorType: "admin",
        adminId,
        stripeRefundId: "re_btn",
      },
    });
    mocks.retrieve.mockResolvedValue(
      stripeRefund({ id: "re_btn", status: "succeeded", amount: 1000, refundId: null }),
    );

    expect(await checkRefundWithStripe({ orderNumber: 1001, refundId: refund.id })).toEqual({
      ok: true,
      data: { status: "pending" },
    });
    expect(mocks.retrieve).not.toHaveBeenCalled();

    await testDb.refund.update({
      where: { id: refund.id },
      data: { createdAt: new Date(Date.now() - 3 * 60 * 1000) },
    });
    expect(await checkRefundWithStripe({ orderNumber: 1001, refundId: refund.id })).toEqual({
      ok: true,
      data: { status: "succeeded" },
    });
  });
});
