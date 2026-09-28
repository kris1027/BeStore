import "server-only";

import { revalidateTag } from "next/cache";
import type Stripe from "stripe";
import { z } from "zod";

import type { OrderStatus } from "@/generated/prisma/client";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { logOrderExpired, logOrderPaid } from "@/lib/orders/log";
import { markExpired, markPaid, type PaidOrder } from "@/lib/orders/transitions";

import { decideEvent, isHandledEventType } from "./event-decision";
import { type EventResult, logEventProcessed, logTagExpiryFailed } from "./log";

const orderIdSchema = z.uuid();

type Outcome =
  | { readonly result: Exclude<EventResult, "paid" | "expired"> }
  | { readonly result: "paid"; readonly order: PaidOrder }
  | { readonly result: "expired"; readonly orderId: string; readonly reason: string };

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

    if (!isHandledEventType(event.type)) return { result: "ignored" };
    // Safe: every handled type is a checkout.session.* event, whose object is a Session.
    const session = event.data.object as Stripe.Checkout.Session;

    // Found from Stripe's own metadata, never from anything the browser sent.
    const orderId = orderIdSchema.safeParse(session.metadata?.order_id);
    if (!orderId.success) return { result: "not_ours" };
    const [order] = await tx.$queryRaw<{ status: OrderStatus }[]>`
      SELECT status FROM orders WHERE id = ${orderId.data}::uuid FOR UPDATE`;
    if (!order) return { result: "not_ours" };
    if (order.status !== "pending_payment") return { result: "stale" };

    const decision = decideEvent(event.type, session.payment_status);
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
  logEventProcessed(event.id, event.type, outcome.result);
  return outcome.result;
}

function paymentIntentId(value: Stripe.Checkout.Session["payment_intent"]): string | null {
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
