import "server-only";

import type { Tx } from "@/lib/db";
import type { LockedOrder } from "@/lib/orders/lock";

import { isInFlight } from "./order-actions";
import type { RefundLedger } from "./refund-math";

// AC-18: a request to Stripe that has not answered yet. Read under the order lock, which every
// refund insert also holds, so no refund can start between this check and the action's write.
export async function hasRefundInFlight(tx: Tx, orderId: string, nowMs: number) {
  const pending = await tx.refund.findMany({
    where: { orderId, status: "pending", stripeRefundId: null },
    select: { status: true, stripeRefundId: true, createdAt: true },
  });
  return pending.some((refund) => isInFlight(refund, nowMs));
}

// The order's lines and refunds for the refund math, read under the order lock.
export async function loadRefundLedger(tx: Tx, order: LockedOrder): Promise<RefundLedger> {
  // One after the other: an interactive transaction runs on a single connection.
  const lines = await tx.orderLine.findMany({
    where: { orderId: order.id },
    orderBy: { id: "asc" },
    select: { id: true, quantity: true, lineTotalCents: true },
  });
  const refunds = await tx.refund.findMany({
    where: { orderId: order.id },
    select: {
      status: true,
      amountCents: true,
      includesShipping: true,
      lines: { select: { orderLineId: true, quantity: true } },
    },
  });
  return {
    totalCents: order.totalCents,
    shippingCents: order.shippingCents,
    lines,
    refunds,
  };
}

// The form's copy of updated_at against the locked row, to the millisecond (timestamptz(3)).
export function isStale(order: LockedOrder, expectedUpdatedAt: string): boolean {
  return order.updatedAt.toISOString() !== new Date(expectedUpdatedAt).toISOString();
}
