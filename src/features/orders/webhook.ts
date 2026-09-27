import "server-only";

import type Stripe from "stripe";

import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";

import { logEventFailed, logInvalidSignature } from "./log";
import { handleStripeEvent } from "./stripe-events";

// POST /api/stripe/webhook (spec 0006, AC-3 and AC-16). The signature is checked on the raw
// body before anything is parsed; a bad one changes nothing. A processing error answers 500 so
// Stripe retries, and the rolled back transaction lets the retry do the work again.
export async function stripeWebhookRequest(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  const body = await request.text();

  let event: Stripe.Event;
  try {
    if (signature === null) throw new Error("missing signature");
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    logInvalidSignature();
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return Response.json({ received: true, result });
  } catch (error) {
    logEventFailed(event.id, event.type, error);
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
