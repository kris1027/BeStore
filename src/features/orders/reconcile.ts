import "server-only";

import type Stripe from "stripe";

import { isCronRequest } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { logOrderExpired } from "@/lib/orders/log";
import { markExpired } from "@/lib/orders/transitions";
import { stripe } from "@/lib/stripe";

import { type HandledEventType, handledEventTypes } from "./event-decision";
import {
  logReconcile,
  logReconcileStripeFailed,
  logReconcileUnresolved,
  type ReconcileCounts,
} from "./log";
import { expireCatalogTags, handleStripeEvent } from "./stripe-events";

export const RECONCILE_BATCH = 100;
// The 30 minute session plus an hour for Stripe's own webhook retries.
export const STALE_AFTER_MS = 90 * 60 * 1000;
export const EVENT_SEARCH_CAP = 500;

// The decisive event wins over the one that only started the story.
const eventPreference: readonly HandledEventType[] = [
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.completed",
  "checkout.session.expired",
];

type Verdict = "paid" | "expired" | "skipped" | "unresolved";

// spec 0006, AC-15: the safety net for a lost webhook. It never decides "paid" itself: it asks
// Stripe for the real event and replays it through the webhook's own handler, so an order still
// ends paid exactly once however often this runs.
export async function reconcileOrders(nowMs: number = Date.now()): Promise<ReconcileCounts> {
  const orders = await db.order.findMany({
    where: { status: "pending_payment", createdAt: { lt: new Date(nowMs - STALE_AFTER_MS) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: RECONCILE_BATCH,
    select: { id: true, stripeCheckoutSessionId: true, createdAt: true, needsAttention: true },
  });

  const counts = { paid: 0, expired: 0, skipped: 0, unresolved: 0 };
  for (const order of orders) {
    counts[await reconcileOrder(order)] += 1;
  }
  // Bounds how long a failed tag expiry after a sale can show stale stock.
  expireCatalogTags([]);
  return { checked: orders.length, ...counts };
}

async function reconcileOrder(order: {
  readonly id: string;
  readonly stripeCheckoutSessionId: string | null;
  readonly createdAt: Date;
  readonly needsAttention: boolean;
}): Promise<Verdict> {
  const sessionId = order.stripeCheckoutSessionId;
  // Never got a session, so nothing at Stripe can take money for it.
  if (sessionId === null) {
    const reason = "No Stripe session";
    const moved = await db.$transaction((tx) => markExpired(tx, order.id, reason));
    if (moved) logOrderExpired(order.id, reason);
    return moved ? "expired" : "skipped";
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    logReconcileStripeFailed(order.id, error);
    return "skipped";
  }
  // Still payable, or a delayed method still processing: the webhook will come.
  if (session.status === "open") return "skipped";
  if (session.status === "complete" && session.payment_status === "unpaid") return "skipped";

  let event: Stripe.Event | null;
  try {
    event = await findDecisiveEvent(sessionId, order.createdAt);
  } catch (error) {
    logReconcileStripeFailed(order.id, error);
    return "skipped";
  }
  if (event !== null) {
    const result = await handleStripeEvent(event);
    if (result === "paid" || result === "expired") return result;
  }

  await flagUnresolved(order, session.status);
  return "unresolved";
}

async function findDecisiveEvent(sessionId: string, since: Date): Promise<Stripe.Event | null> {
  const found: Stripe.Event[] = [];
  let seen = 0;
  for await (const event of stripe.events.list({
    types: [...handledEventTypes],
    created: { gte: Math.floor(since.getTime() / 1000) - 60 },
    limit: 100,
  })) {
    if ((event.data.object as { id?: unknown }).id === sessionId) found.push(event);
    seen += 1;
    if (seen >= EVENT_SEARCH_CAP) break;
  }
  const rank = (event: Stripe.Event) => eventPreference.indexOf(event.type as HandledEventType);
  return found.toSorted((a, b) => rank(a) - rank(b))[0] ?? null;
}

// Stripe says the session is over, but no event explains it: a person has to look. The note is
// written once, not on every daily run.
async function flagUnresolved(
  order: { readonly id: string; readonly needsAttention: boolean },
  sessionStatus: string | null,
) {
  logReconcileUnresolved(order.id, sessionStatus);
  if (order.needsAttention) return;
  await db.$transaction([
    db.order.update({ where: { id: order.id }, data: { needsAttention: true } }),
    db.orderEvent.create({
      data: {
        orderId: order.id,
        type: "note",
        actorType: "system",
        message: `Stripe reports the checkout session as ${sessionStatus ?? "unknown"}, but no Stripe event for it was found. Check the payment in the Stripe dashboard.`,
      },
    }),
  ]);
}

// GET /api/cron/reconcile-orders, run daily by Vercel Cron.
export async function reconcileOrdersRequest(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const counts = await reconcileOrders();
  logReconcile(counts);
  return Response.json(counts);
}
