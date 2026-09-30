import { logger } from "@/lib/logger";

import type { StartCheckoutError } from "./actions/start-checkout";

// spec 0006, Observability and AC-17: order ids, numbers and amounts, never the email. spec
// 0007, AC-14: never a name, address line, postal code or phone either.

export function logCheckoutStarted(fields: {
  readonly orderId: string;
  readonly number: number;
  readonly totalCents: number;
  readonly shippingCents: number;
}) {
  logger.info({ event: "checkout.started", ...fields }, "checkout.started");
}

// Only the code, and for a validation refusal the names of the fields: the messages, the values
// and a Zod error (its issues can echo the input) never reach a log.
export function logCheckoutRefused(error: StartCheckoutError) {
  logger.info(
    {
      event: "checkout.refused",
      reason: error.code,
      ...(error.code === "validation" ? { fields: Object.keys(error.fields) } : {}),
    },
    "checkout.refused",
  );
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
