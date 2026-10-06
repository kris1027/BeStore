// Pure: what every admin order action can refuse with (spec 0010, API surface) and the fixed
// words the admin sees for it.

export type OrderActionError =
  | { readonly code: "not_found" }
  | { readonly code: "stale" }
  | { readonly code: "invalid_transition" }
  | { readonly code: "refund_in_progress" }
  | { readonly code: "payment_in_progress" }
  | { readonly code: "invalid_input"; readonly fields: Readonly<Record<string, readonly string[]>> }
  | { readonly code: "stripe_refused"; readonly message: string }
  // refundPending: a refund may exist at Stripe and stays pending for the sync to settle.
  | { readonly code: "stripe_unavailable"; readonly refundPending: boolean };

export const staleMessage = "This order changed. Reload to see the latest.";
export const refundInProgressMessage = "A refund is in progress for this order.";
export const paymentInProgressMessage =
  "A payment is in progress for this order. Wait for it to settle.";
export const refundCheckingMessage = "Stripe did not answer. The refund is being checked.";
export const stripeRetryMessage = "Stripe did not answer. Try again.";
export const nothingChangedMessage = "Nothing changed.";
// AC-15: expiring the checkout let Stripe's expiry event settle the order first.
export const expiredBeforeCancelMessage =
  "The checkout expired first, so the order is expired. No payment can be taken.";

export function stripeRefusedMessage(message: string): string {
  return `Stripe refused the refund: ${message}`;
}

// The form level message; invalid_input also marks its fields.
export function errorMessage(error: OrderActionError): string {
  switch (error.code) {
    case "not_found":
    case "stale":
    case "invalid_transition":
      return staleMessage;
    case "refund_in_progress":
      return refundInProgressMessage;
    case "payment_in_progress":
      return paymentInProgressMessage;
    case "invalid_input":
      return error.fields.root?.[0] ?? "Check the highlighted fields.";
    case "stripe_refused":
      return stripeRefusedMessage(error.message);
    case "stripe_unavailable":
      return error.refundPending ? refundCheckingMessage : stripeRetryMessage;
  }
}
