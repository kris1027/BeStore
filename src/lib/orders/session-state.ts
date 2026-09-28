import type Stripe from "stripe";

// Pure: what a Checkout Session's `status` and `payment_status` pair means for its order (spec
// 0006, AC-4, AC-6, AC-9, AC-11, AC-15). The one place that pair is read, so the webhook, the
// reconcile cron, a checkout restart and the confirmation page cannot disagree about it.
export type SessionState =
  // Still payable on Stripe's hosted page.
  | "open"
  // Complete and the money is in, or none was owed.
  | "paid"
  // Complete, but a delayed method (a bank debit) is still settling.
  | "processing"
  // Over without payment.
  | "expired"
  // A value Stripe added after our pinned API version (its types allow any string). Money may
  // have moved, so no caller settles or replaces an order on it.
  | "unknown";

export type SessionFields = Pick<Stripe.Checkout.Session, "status" | "payment_status">;

export function sessionState(session: SessionFields): SessionState {
  switch (session.status) {
    case "open":
      return "open";
    case "expired":
      return "expired";
    case "complete":
      switch (session.payment_status) {
        case "paid":
        case "no_payment_required":
          return "paid";
        case "unpaid":
          return "processing";
        default:
          return "unknown";
      }
    default:
      return "unknown";
  }
}
