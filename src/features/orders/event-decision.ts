// Pure: what one Stripe Checkout event means for a pending order (spec 0006, Event handling).

import { sessionState } from "@/lib/orders/session-state";

export const handledEventTypes = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
] as const;

export type HandledEventType = (typeof handledEventTypes)[number];

export function isHandledEventType(type: string): type is HandledEventType {
  return (handledEventTypes as readonly string[]).includes(type);
}

export type EventDecision =
  | { readonly kind: "pay" }
  | { readonly kind: "processing" }
  | { readonly kind: "expire"; readonly reason: string };

export const expiryReasons = {
  paymentFailed: "Payment failed",
  sessionExpired: "Checkout session expired",
} as const;

// A completed event carries a complete session. Anything but paid (a delayed method still
// settling, or a payment status we do not know) waits for async_payment_succeeded or
// async_payment_failed, and the reconcile cron flags it if neither comes.
export function decideEvent(type: HandledEventType, paymentStatus: string): EventDecision {
  switch (type) {
    case "checkout.session.completed":
      return sessionState({ status: "complete", payment_status: paymentStatus }) === "paid"
        ? { kind: "pay" }
        : { kind: "processing" };
    case "checkout.session.async_payment_succeeded":
      return { kind: "pay" };
    case "checkout.session.async_payment_failed":
      return { kind: "expire", reason: expiryReasons.paymentFailed };
    case "checkout.session.expired":
      return { kind: "expire", reason: expiryReasons.sessionExpired };
  }
}
