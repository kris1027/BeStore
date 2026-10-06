import "server-only";

import { revalidateTag } from "next/cache";
import type Stripe from "stripe";
import { z } from "zod";

import type { OrderStatus } from "@/generated/prisma/client";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import type { Tx } from "@/lib/db";
import { logOrderExpired, logOrderPaid } from "@/lib/orders/log";
import { flagLatePayment, markExpired, markPaid, type PaidOrder } from "@/lib/orders/transitions";

import { decideEvent, isHandledEventType, isRefundEventType } from "./event-decision";
import { type EventResult, logEventProcessed, logTagExpiryFailed } from "./log";
import { lockOrderById } from "./order-lock";
import {
  type AppliedOutcome,
  applyRefundOutcome,
  findRefundRow,
  recordSystemRefund,
  reportOf,
} from "./refunds";

const orderIdSchema = z.uuid();

type Outcome =
  | { readonly result: Exclude<EventResult, "paid" | "expired" | "refund"> }
  | { readonly result: "paid"; readonly order: PaidOrder }
  | { readonly result: "expired"; readonly orderId: string; readonly reason: string }
  | { readonly result: "refund"; readonly applied: AppliedOutcome };

// The one path from a Stripe event to an order change, shared by the webhook and the reconcile
// cron (spec 0006, Event handling). The stripe_events row and the change share one transaction:
// a replayed event finds its row and does nothing, and a thrown error rolls both back so
// Stripe's retry does the work again. Callers pass only an event whose signature was verified
// or that was fetched from Stripe with the secret key.
export async function handleStripeEvent(event: Stripe.Event): Promise<EventResult> {
  const outcome = await db.$transaction(async (tx): Promise<Outcome> => {
    const inserted = await tx.$executeRaw`
      INSERT INTO stripe_events (id, type) VALUES (${event.id}, ${event.type})
      ON CONFLICT (id) DO NOTHING`;
    if (inserted === 0) return { result: "duplicate" };

    if (isRefundEventType(event.type)) return handleRefundEvent(tx, event);
    if (!isHandledEventType(event.type)) return { result: "ignored" };
    // Safe: every handled type is a checkout.session.* event, whose object is a Session.
    const session = event.data.object as Stripe.Checkout.Session;

    // Found from Stripe's own metadata, never from anything the browser sent.
    const orderId = orderIdSchema.safeParse(session.metadata?.order_id);
    if (!orderId.success) return { result: "not_ours" };
    const [order] = await tx.$queryRaw<{ status: OrderStatus }[]>`
      SELECT status FROM orders WHERE id = ${orderId.data}::uuid FOR UPDATE`;
    if (!order) return { result: "not_ours" };

    const decision = decideEvent(event.type, session.payment_status);
    if (order.status !== "pending_payment") {
      // spec 0010, AC-15: money for an order an admin cancelled (or that expired) is never kept
      // silently. markPaid would refuse it, so the order is flagged for a refund instead.
      const late =
        decision.kind === "pay" &&
        (await flagLatePayment(tx, orderId.data, paymentIntentId(session.payment_intent)));
      if (late) {
        return { result: "late_payment" };
      }
      return { result: "stale" };
    }

    switch (decision.kind) {
      case "processing":
        return { result: "processing" };
      case "expire": {
        const moved = await markExpired(tx, orderId.data, decision.reason);
        return moved
          ? { result: "expired", orderId: orderId.data, reason: decision.reason }
          : { result: "stale" };
      }
      case "pay": {
        const paid = await markPaid(tx, {
          orderId: orderId.data,
          paidAt: new Date(event.created * 1000),
          paymentIntentId: paymentIntentId(session.payment_intent),
          amountTotal: session.amount_total,
          currency: session.currency,
        });
        return paid ? { result: "paid", order: paid } : { result: "stale" };
      }
    }
  });

  if (outcome.result === "paid") {
    logOrderPaid(outcome.order);
    expireCatalogTags(outcome.order.productSlugs);
  }
  if (outcome.result === "expired") logOrderExpired(outcome.orderId, outcome.reason);
  if (outcome.result === "refund" && outcome.applied.productSlugs.length > 0) {
    expireCatalogTags(outcome.applied.productSlugs);
  }
  logEventProcessed(event.id, event.type, outcome.result);
  return outcome.result;
}

// spec 0010, AC-16: a refund on one of our orders' payments. The order comes from Stripe's
// payment_intent, never from the browser, and is locked before the refund row is matched, so a
// refund.created and a refund.updated for the same dashboard refund cannot both record it.
async function handleRefundEvent(tx: Tx, event: Stripe.Event): Promise<Outcome> {
  // Safe: every refund.* event's object is a Refund.
  const refund = event.data.object as Stripe.Refund;
  const intent = paymentIntentId(refund.payment_intent);
  if (intent === null) return { result: "not_ours" };
  const owner = await tx.order.findUnique({
    where: { stripePaymentIntentId: intent },
    select: { id: true },
  });
  if (!owner) return { result: "not_ours" };
  const order = await lockOrderById(tx, owner.id);
  if (!order) return { result: "not_ours" };

  const at = new Date(event.created * 1000);
  const rowId = await findRefundRow(tx, order.id, refund.id, refund.metadata?.refund_id);
  const applied =
    rowId === null
      ? await recordSystemRefund(tx, order, refund, at)
      : await applyRefundOutcome(tx, rowId, reportOf(refund, at), "webhook");
  return applied === null ? { result: "not_ours" } : { result: "refund", applied };
}

function paymentIntentId(
  value: Stripe.Checkout.Session["payment_intent"] | Stripe.Refund["payment_intent"],
): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value : value.id;
}

// After the commit, so the storefront shows the new stock (AC-4). The sale is committed either
// way; a failure here only means stale stock shows until the next catalog write or the daily
// reconcile run, and add to cart and checkout recheck stock regardless.
export function expireCatalogTags(productSlugs: readonly string[]) {
  try {
    revalidateTag(catalogTag, { expire: 0 });
    for (const slug of productSlugs) revalidateTag(productTag(slug), { expire: 0 });
  } catch (error) {
    logTagExpiryFailed(error);
  }
}
