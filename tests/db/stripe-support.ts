import Stripe from "stripe";

import { testDb } from "./client";
import { createSimpleProduct, inThirtyDays } from "./fixtures";

// Real Stripe event JSON, signed the way Stripe signs it, for the webhook and reconcile suites
// (spec 0006, Critical test scenarios). Only the API calls are stubbed.

export const WEBHOOK_SECRET = "whsec_test_secret";

// A real client used only for its local helpers (signing, verifying); it never calls the API.
export const offlineStripe = new Stripe("sk_test_offline");

export type SessionEventInput = {
  readonly id?: string;
  readonly orderId?: string | null;
  readonly sessionId?: string;
  readonly paymentStatus?: "paid" | "unpaid" | "no_payment_required";
  readonly amountTotal?: number;
  readonly currency?: string;
  readonly paymentIntent?: string | null;
  readonly created?: number;
};

let eventCounter = 0;

export function sessionEvent(type: string, input: SessionEventInput = {}): Stripe.Event {
  eventCounter += 1;
  const sessionId = input.sessionId ?? "cs_test_session1";
  return {
    id: input.id ?? `evt_test_${eventCounter}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: input.created ?? Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        status: type === "checkout.session.expired" ? "expired" : "complete",
        payment_status: input.paymentStatus ?? "paid",
        amount_total: input.amountTotal ?? 5000,
        currency: input.currency ?? "eur",
        payment_intent: input.paymentIntent === undefined ? "pi_test_1" : input.paymentIntent,
        metadata: input.orderId === null ? {} : { order_id: input.orderId ?? "" },
      },
    },
  } as unknown as Stripe.Event;
}

export function signedRequest(event: Stripe.Event, secret = WEBHOOK_SECRET): Request {
  const payload = JSON.stringify(event);
  const signature = offlineStripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
}

// A pending order made the way startCheckout makes one: a cart, one line, one created event.
export async function seedPendingOrder(
  options: {
    readonly suffix?: string;
    readonly stock?: number;
    readonly quantity?: number;
    readonly priceCents?: number;
    readonly sessionId?: string | null;
    readonly createdAt?: Date;
  } = {},
) {
  const suffix = options.suffix ?? "1";
  const quantity = options.quantity ?? 2;
  const priceCents = options.priceCents ?? 2500;
  const { product, variant } = await createSimpleProduct(suffix, options.stock ?? 5);
  const cart = await testDb.cart.create({
    data: { expiresAt: inThirtyDays(), items: { create: { variantId: variant.id, quantity } } },
  });
  const total = priceCents * quantity;
  const order = await testDb.order.create({
    data: {
      cartId: cart.id,
      email: "ada@example.com",
      currency: "EUR",
      subtotalCents: total,
      totalCents: total,
      stripeCheckoutSessionId:
        options.sessionId === undefined ? `cs_test_session${suffix}` : options.sessionId,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      lines: {
        create: {
          variantId: variant.id,
          productId: product.id,
          productName: product.name,
          sku: variant.sku,
          unitPriceCents: priceCents,
          quantity,
          lineTotalCents: total,
        },
      },
      events: { create: { type: "created", toStatus: "pending_payment", actorType: "customer" } },
    },
  });
  return { product, variant, cart, order };
}

export async function stock(variantId: string): Promise<number | undefined> {
  return (await testDb.productVariant.findUnique({ where: { id: variantId } }))?.stockQuantity;
}

export async function eventsOf(orderId: string) {
  return testDb.orderEvent.findMany({
    where: { orderId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

// What stripe.events.list returns: an auto paging async iterable.
export function autoPaging<T>(items: readonly T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}
