// The Stripe events the webhook acts on: the orders feature decides what each means, and
// `pnpm dev:docker` forwards exactly these, as the staging and production endpoints subscribe.

export const handledEventTypes = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
] as const;

// spec 0010, AC-16.
export const refundEventTypes = ["refund.created", "refund.updated", "refund.failed"] as const;
