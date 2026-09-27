import { logger } from "@/lib/logger";

// spec 0006, Observability and AC-17: order ids, numbers and amounts, never the email.

export type CheckoutRefusal =
  | "validation"
  | "cart_changed"
  | "below_minimum"
  | "payment_processing"
  | "already_paid"
  | "checkout_in_progress"
  | "payment_unavailable";

export function logCheckoutStarted(fields: {
  readonly orderId: string;
  readonly number: number;
  readonly totalCents: number;
}) {
  logger.info({ event: "checkout.started", ...fields }, "checkout.started");
}

export function logCheckoutRefused(reason: CheckoutRefusal) {
  logger.info({ event: "checkout.refused", reason }, "checkout.refused");
}

// `stripeCode`, not `code`: the logger redacts any key named code.
export function logStripeFailed(orderId: string, error: unknown) {
  logger.error(
    {
      event: "checkout.stripe_failed",
      orderId,
      stripeCode: stripeErrorCode(error) ?? null,
      stripeType: errorType(error),
    },
    "checkout.stripe_failed",
  );
}

export function stripeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

// Stripe's error class (StripeConnectionError, StripeAuthenticationError, ...), for errors that
// carry no code.
function errorType(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("type" in error)) return null;
  return typeof error.type === "string" ? error.type : null;
}
