import "server-only";

import Stripe from "stripe";

import { env } from "@/lib/env";

// Pinned to the version the installed SDK is typed for, so an SDK upgrade is a deliberate
// change and the webhook payloads keep the shape the code reads (spec 0006).
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: STRIPE_API_VERSION,
  maxNetworkRetries: 2,
  timeout: 10_000,
});

// The dashboard link for an order's payment (spec 0006, Value sourcing): test mode keys see the
// test dashboard.
export function stripeDashboardUrl(
  target: { readonly paymentIntentId: string } | { readonly sessionId: string },
): string {
  const mode = /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY) ? "test/" : "";
  const path =
    "paymentIntentId" in target
      ? `payments/${target.paymentIntentId}`
      : `checkout/sessions/${target.sessionId}`;
  return `https://dashboard.stripe.com/${mode}${path}`;
}
