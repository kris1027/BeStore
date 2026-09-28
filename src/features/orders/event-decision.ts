// Pure: what one Stripe Checkout event means for a pending order (spec 0006, Event handling).

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

// `unpaid` on completed is a delayed method (a bank debit): the money is not in yet, so the
// order waits for async_payment_succeeded or async_payment_failed.
export function decideEvent(type: HandledEventType, paymentStatus: string): EventDecision {
  switch (type) {
    case "checkout.session.completed":
      return paymentStatus === "paid" || paymentStatus === "no_payment_required"
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
