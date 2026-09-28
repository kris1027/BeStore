import { logger } from "@/lib/logger";

// spec 0006, Observability and AC-17: event ids, order ids and counts only. Never the
// signature header, an email or anything about the card.

export type EventResult =
  "paid" | "expired" | "processing" | "duplicate" | "ignored" | "not_ours" | "stale";

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
