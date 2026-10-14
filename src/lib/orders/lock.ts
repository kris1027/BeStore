import "server-only";

import { type OrderStatus, Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";

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

// Sets the order's attention flag, leaving it alone when it is already on. Call it under the
// order lock.
export async function flagOrder(tx: Tx, orderId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE orders SET needs_attention = true, updated_at = now()
    WHERE id = ${orderId}::uuid AND NOT needs_attention`;
}
