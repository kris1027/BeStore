import "server-only";

import { type OrderStatus, Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";

import { isInFlight } from "./order-actions";
import type { RefundLedger } from "./refund-math";

// The order row as every admin action and refund path sees it: read under FOR UPDATE, so the
// checks that follow (spec 0010, AC-8) judge the row the guarded update will move.

export type LockedOrder = {
  readonly id: string;
  readonly number: number;
  readonly status: OrderStatus;
  readonly needsAttention: boolean;
  readonly updatedAt: Date;
  readonly currency: string;
  readonly totalCents: number;
  readonly shippingCents: number;
  readonly refundedCents: number;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
  readonly paymentIntentId: string | null;
  readonly sessionId: string | null;
};

type Row = {
  id: string;
  number: number;
  status: OrderStatus;
  needs_attention: boolean;
  updated_at: Date;
  currency: string;
  total_cents: number;
  shipping_cents: number;
  refunded_cents: number;
  carrier: string | null;
  tracking_number: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
};

function toLocked(row: Row): LockedOrder {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    needsAttention: row.needs_attention,
    updatedAt: row.updated_at,
    currency: row.currency,
    totalCents: row.total_cents,
    shippingCents: row.shipping_cents,
    refundedCents: row.refunded_cents,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    paymentIntentId: row.stripe_payment_intent_id,
    sessionId: row.stripe_checkout_session_id,
  };
}

// Both lookups read the same columns; only the row they pick differs.
async function lockOrderWhere(tx: Tx, where: Prisma.Sql): Promise<LockedOrder | null> {
  const [row] = await tx.$queryRaw<Row[]>`
    SELECT id, number, status, needs_attention, updated_at, currency, total_cents, shipping_cents,
           refunded_cents, carrier, tracking_number, stripe_payment_intent_id,
           stripe_checkout_session_id
    FROM orders WHERE ${where} FOR UPDATE`;
  return row ? toLocked(row) : null;
}

export function lockOrderByNumber(tx: Tx, number: number): Promise<LockedOrder | null> {
  return lockOrderWhere(tx, Prisma.sql`number = ${number}`);
}

export function lockOrderById(tx: Tx, id: string): Promise<LockedOrder | null> {
  return lockOrderWhere(tx, Prisma.sql`id = ${id}::uuid`);
}

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
