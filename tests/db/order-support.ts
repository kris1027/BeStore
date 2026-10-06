import type Stripe from "stripe";

import { testDb } from "./client";
import { seedPendingOrder } from "./stripe-support";

// Builders for the admin order management suites (spec 0010).

let refundCounter = 0;

// What stripe.refunds.create / retrieve answer, shaped like a real Refund.
export function stripeRefund(
  overrides: Partial<{
    id: string;
    status: string;
    amount: number;
    paymentIntent: string;
    refundId: string | null;
    failureReason: string | null;
    reason: string | null;
  }> = {},
): Stripe.Refund {
  refundCounter += 1;
  return {
    id: overrides.id ?? `re_test_${refundCounter}`,
    object: "refund",
    amount: overrides.amount ?? 1000,
    currency: "eur",
    status: overrides.status ?? "succeeded",
    payment_intent: overrides.paymentIntent ?? "pi_test_1",
    reason: overrides.reason ?? "requested_by_customer",
    failure_reason: overrides.failureReason ?? null,
    metadata: overrides.refundId === null ? {} : { refund_id: overrides.refundId ?? "" },
    created: Math.floor(Date.now() / 1000),
  } as unknown as Stripe.Refund;
}

export function refundEvent(type: string, refund: Stripe.Refund, id?: string): Stripe.Event {
  refundCounter += 1;
  return {
    id: id ?? `evt_refund_${refundCounter}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object: refund },
  } as unknown as Stripe.Event;
}

// A paid order made the real way: pending order, then the paid transition with its sale
// movements. Status `shipped` or `delivered` are set on top.
export async function seedPaidOrder(
  options: Parameters<typeof seedPendingOrder>[0] & {
    readonly paymentIntentId?: string;
    readonly shippingCents?: number;
  } = {},
) {
  const seeded = await seedPendingOrder(options);
  const { markPaid } = await import("@/lib/orders/transitions");
  const paymentIntentId = options.paymentIntentId ?? "pi_test_1";
  await testDb.$transaction((tx) =>
    markPaid(tx, {
      orderId: seeded.order.id,
      paidAt: new Date(),
      paymentIntentId,
      amountTotal: seeded.order.totalCents,
      currency: "eur",
    }),
  );
  if (options.shippingCents) {
    await testDb.order.update({
      where: { id: seeded.order.id },
      data: {
        shippingCents: options.shippingCents,
        totalCents: seeded.order.totalCents + options.shippingCents,
      },
    });
  }
  return { ...seeded, paymentIntentId };
}

export async function orderRef(number = 1001) {
  const order = await testDb.order.findUniqueOrThrow({ where: { number } });
  return { orderNumber: number, expectedUpdatedAt: order.updatedAt.toISOString() };
}

export async function orderOf(number = 1001) {
  return testDb.order.findUniqueOrThrow({ where: { number } });
}

export async function refundsOf(orderId: string) {
  return testDb.refund.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    include: { lines: true },
  });
}

export async function returnsOf(orderId: string) {
  return testDb.stockMovement.findMany({
    where: { orderId, kind: "return" },
    select: { variantId: true, delta: true, stockAfter: true, adminId: true, actorType: true },
  });
}
