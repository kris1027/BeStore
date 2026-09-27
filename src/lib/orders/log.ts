import { logger } from "@/lib/logger";

import type { AmountMismatch, PaidOrder, Shortfall } from "./transitions";

// spec 0006, Observability and AC-17: order ids, numbers and amounts only, never an email.
// Called after the transaction commits, so a rolled back change is never logged as done.

export function logOrderPaid(order: PaidOrder) {
  const base = { orderId: order.orderId, number: order.number };
  logger.info({ event: "order.paid", ...base, totalCents: order.totalCents }, "order.paid");
  if (order.shortfalls.length > 0) logStockShortfall(order.orderId, order.shortfalls);
  if (order.mismatch) logAmountMismatch(order.orderId, order.mismatch);
}

export function logOrderExpired(orderId: string, reason: string) {
  logger.info({ event: "order.expired", orderId, reason }, "order.expired");
}

function logStockShortfall(orderId: string, skus: readonly Shortfall[]) {
  logger.error({ event: "order.stock_shortfall", orderId, skus }, "order.stock_shortfall");
}

function logAmountMismatch(orderId: string, mismatch: AmountMismatch) {
  logger.error({ event: "order.amount_mismatch", orderId, ...mismatch }, "order.amount_mismatch");
}
