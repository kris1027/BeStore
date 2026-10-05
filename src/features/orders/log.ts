import { pgErrorCode } from "@/lib/db-errors";
import { logger } from "@/lib/logger";

// spec 0006, Observability and AC-17: event ids, order ids and counts only. Never the
// signature header, an email or anything about the card.

export type EventResult =
  | "paid"
  | "expired"
  | "processing"
  | "duplicate"
  | "ignored"
  | "not_ours"
  | "stale"
  // spec 0010, AC-15: a payment for an order that was cancelled or expired, now flagged.
  | "late_payment"
  // spec 0010, AC-16: a refund event, applied to its refund row (or recorded as a system one).
  | "refund";

export function logEventProcessed(eventId: string, type: string, result: EventResult) {
  logger.info({ event: "stripe.event.processed", eventId, type, result }, "stripe.event.processed");
}

export function logEventFailed(eventId: string, type: string, error: unknown) {
  logger.error(
    {
      event: "stripe.event.failed",
      eventId,
      type,
      message: error instanceof Error ? error.message : String(error),
    },
    "stripe.event.failed",
  );
}

export function logInvalidSignature() {
  logger.warn({ event: "stripe.webhook.invalid_signature" }, "stripe.webhook.invalid_signature");
}

export function logTagExpiryFailed(error: unknown) {
  logger.error(
    {
      event: "cache.tag_expiry_failed",
      message: error instanceof Error ? error.message : String(error),
    },
    "cache.tag_expiry_failed",
  );
}

export type ReconcileCounts = {
  readonly checked: number;
  readonly paid: number;
  readonly expired: number;
  readonly skipped: number;
  readonly unresolved: number;
};

export function logReconcile(counts: ReconcileCounts) {
  const fields = { event: "cron.reconcile_orders", ...counts };
  if (counts.unresolved > 0) logger.error(fields, "cron.reconcile_orders");
  else logger.info(fields, "cron.reconcile_orders");
}

export function logReconcileUnresolved(orderId: string, sessionStatus: string | null) {
  logger.error(
    { event: "order.reconcile_unresolved", orderId, sessionStatus },
    "order.reconcile_unresolved",
  );
}

export function logReconcileStripeFailed(orderId: string, error: unknown) {
  logger.error(
    {
      event: "cron.reconcile_stripe_failed",
      orderId,
      message: error instanceof Error ? error.message : String(error),
    },
    "cron.reconcile_stripe_failed",
  );
}

export function logReconcileOrderFailed(orderId: string, error: unknown) {
  logger.error(
    {
      event: "cron.reconcile_order_failed",
      orderId,
      message: error instanceof Error ? error.message : String(error),
    },
    "cron.reconcile_order_failed",
  );
}

// spec 0008, AC-6 and AC-7: counts, the error's name and its SQLSTATE only. Never its message
// or meta, since a Postgres error detail can quote the failing row's email or address.
export function logPurgeExpiredOrders(purged: number) {
  logger.info({ event: "cron.purge_expired_orders", purged }, "cron.purge_expired_orders");
}

// `pgCode`, not `code`: the logger redacts any key named code.
export function logPurgeExpiredOrdersFailed(
  purged: number,
  errorName: string,
  pgCode: string | null,
) {
  logger.error(
    { event: "cron.purge_expired_orders_failed", purged, errorName, pgCode },
    "cron.purge_expired_orders_failed",
  );
}

// ─── Admin order management (spec 0010, Observability and AC-23) ────────────
// Order ids, numbers, refund ids, amounts and the admin id. Never an email, a name, an address,
// a reason, a note, a carrier or tracking number, or anything about the card.

type RefundFields = {
  readonly orderId: string;
  readonly refundId: string;
  readonly amountCents: number;
};

export function logRefundSucceeded(fields: RefundFields) {
  logger.info({ event: "refund.succeeded", ...fields }, "refund.succeeded");
}

export function logRefundFailed(fields: RefundFields & { readonly from: string }) {
  logger.warn({ event: "refund.failed", ...fields }, "refund.failed");
}

// After a refund had been accepted by Stripe (pending or succeeded), it failed: money the
// store promised back did not move, so a person must look.
export function logRefundLateFailure(fields: RefundFields & { readonly from: string }) {
  logger.error({ event: "refund.late_failure", ...fields }, "refund.late_failure");
}

// `stripeCode`, not `code`: the logger redacts any key named code.
export function logRefundStripeRefused(
  fields: RefundFields & { readonly errorType: string; readonly stripeCode: string | null },
) {
  logger.warn({ event: "refund.stripe_refused", ...fields }, "refund.stripe_refused");
}

export function logRefundStripeUnavailable(fields: RefundFields & { readonly errorType: string }) {
  logger.error({ event: "refund.stripe_unavailable", ...fields }, "refund.stripe_unavailable");
}

export function logRefundRestocked(fields: {
  readonly orderId: string;
  readonly refundId: string;
  readonly variantId: string;
  readonly returned: number;
  readonly requested: number;
}) {
  logger.info({ event: "refund.restocked", ...fields }, "refund.restocked");
}

export function logRefundRestockSkipped(fields: {
  readonly orderId: string;
  readonly refundId: string;
  readonly orderLineId: string;
}) {
  logger.warn({ event: "refund.restock_skipped", ...fields }, "refund.restock_skipped");
}

export function logSystemRefundRecorded(fields: RefundFields & { readonly status: string }) {
  logger.info({ event: "refund.system_recorded", ...fields }, "refund.system_recorded");
}

export function logRefundUnknownStatus(fields: {
  readonly orderId: string;
  readonly refundId: string;
  readonly stripeStatus: string | null;
}) {
  logger.error({ event: "refund.unknown_status", ...fields }, "refund.unknown_status");
}

export type RefundSyncCounts = {
  readonly checked: number;
  readonly settled: number;
  readonly failed: number;
  readonly skipped: number;
};

export function logReconcileRefunds(counts: RefundSyncCounts) {
  logger.info({ event: "cron.reconcile_refunds", ...counts }, "cron.reconcile_refunds");
}

export function logReconcileRefundFailed(refundId: string, error: unknown) {
  logger.error(
    {
      event: "cron.reconcile_refund_failed",
      refundId,
      errorName: error instanceof Error ? error.name : typeof error,
      pgCode: pgErrorCode(error),
    },
    "cron.reconcile_refund_failed",
  );
}
