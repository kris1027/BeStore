import "server-only";

import type { OrderStatus, Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { type MovementRow, recordMovements } from "@/lib/stock-movements";

// The only code that changes orders.status (spec 0006 and spec 0010, State transitions). Every
// function runs inside the caller's transaction and moves an order only while it is still in
// the status it moves from: zero rows updated means another path already moved it, so they do
// nothing else. Raw SQL never runs Prisma's @updatedAt, so each statement sets updated_at.

export type Shortfall = { readonly sku: string; readonly missing: number };

export type AmountMismatch = {
  readonly expectedCents: number;
  readonly expectedCurrency: string;
  readonly receivedCents: number | null;
  readonly receivedCurrency: string | null;
};

export type PaidOrder = {
  readonly orderId: string;
  readonly number: number;
  readonly totalCents: number;
  readonly shortfalls: readonly Shortfall[];
  readonly mismatch: AmountMismatch | null;
  // Product slugs whose storefront cache must expire once the transaction commits.
  readonly productSlugs: readonly string[];
};

export type PaidInput = {
  readonly orderId: string;
  // The Stripe event's own time, never the server clock.
  readonly paidAt: Date;
  readonly paymentIntentId: string | null;
  // What Stripe charged, compared against the order's frozen total.
  readonly amountTotal: number | null;
  readonly currency: string | null;
};

// Only ever called with a Stripe event that was verified by signature (the webhook) or fetched
// from Stripe with the secret key (the reconcile cron). Returns null when the order had already
// left pending_payment.
export async function markPaid(tx: Tx, input: PaidInput): Promise<PaidOrder | null> {
  const [order] = await tx.$queryRaw<
    { number: number; total_cents: number; currency: string; cart_id: string | null }[]
  >`
    UPDATE orders
    SET status = 'paid', paid_at = ${input.paidAt}, stripe_payment_intent_id = ${input.paymentIntentId},
        updated_at = now()
    WHERE id = ${input.orderId}::uuid AND status = 'pending_payment'
    RETURNING number, total_cents, currency, cart_id`;
  if (!order) return null;

  // By variant id, so two paid orders taking the same variants lock them in the same order and
  // never deadlock. Lines whose variant was deleted sort last and are short by their quantity.
  const lines = await tx.orderLine.findMany({
    where: { orderId: input.orderId },
    orderBy: [{ variantId: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { variantId: true, productId: true, sku: true, quantity: true },
  });

  const shortfalls: Shortfall[] = [];
  const sales: MovementRow[] = [];
  for (const line of lines) {
    const stock =
      line.variantId === null ? null : await takeStock(tx, line.variantId, line.quantity);
    const taken = stock === null ? 0 : stock.before - stock.after;
    if (taken < line.quantity) shortfalls.push({ sku: line.sku, missing: line.quantity - taken });
    // spec 0009, AC-11: what the sale really took (2 of 3 asked is -2); nothing taken, no row.
    if (stock !== null && line.variantId !== null && taken > 0) {
      sales.push({
        kind: "sale",
        variantId: line.variantId,
        delta: -taken,
        stockAfter: stock.after,
        orderId: input.orderId,
      });
    }
  }
  await recordMovements(tx, sales);

  const receivedCurrency = input.currency?.toUpperCase() ?? null;
  const mismatch: AmountMismatch | null =
    input.amountTotal === order.total_cents && receivedCurrency === order.currency
      ? null
      : {
          expectedCents: order.total_cents,
          expectedCurrency: order.currency,
          receivedCents: input.amountTotal,
          receivedCurrency,
        };

  const events: Prisma.OrderEventCreateManyInput[] = [
    {
      orderId: input.orderId,
      type: "status_changed",
      fromStatus: "pending_payment",
      toStatus: "paid",
      actorType: "system",
      message: "Payment received",
    },
  ];
  if (shortfalls.length > 0) {
    events.push({
      orderId: input.orderId,
      type: "stock_shortfall",
      actorType: "system",
      message: `Not enough stock: ${shortfalls.map((s) => `${s.sku} short by ${s.missing}`).join(", ")}`,
    });
  }
  if (mismatch) {
    events.push({
      orderId: input.orderId,
      type: "note",
      actorType: "system",
      message:
        `Amount mismatch: Stripe charged ${mismatch.receivedCents ?? "no amount"} ` +
        `${mismatch.receivedCurrency ?? "(no currency)"}, the order total is ` +
        `${mismatch.expectedCents} ${mismatch.expectedCurrency} (minor units).`,
    });
  }
  await tx.orderEvent.createMany({ data: events });
  if (shortfalls.length > 0 || mismatch) {
    await tx.order.update({ where: { id: input.orderId }, data: { needsAttention: true } });
  }

  if (order.cart_id !== null) await tx.cart.deleteMany({ where: { id: order.cart_id } });

  const productIds = [
    ...new Set(lines.flatMap((line) => (line.productId === null ? [] : [line.productId]))),
  ];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { slug: true },
  });

  return {
    orderId: input.orderId,
    number: order.number,
    totalCents: order.total_cents,
    shortfalls,
    mismatch,
    productSlugs: products.map((product) => product.slug),
  };
}

// Takes what stock there is, never below 0, and answers the count before and after, or null
// when the variant row is gone. The CTE locks the row and reads the value the UPDATE starts
// from, so a concurrent sale cannot slip in between.
async function takeStock(
  tx: Tx,
  variantId: string,
  quantity: number,
): Promise<{ readonly before: number; readonly after: number } | null> {
  const [row] = await tx.$queryRaw<{ before: number; after: number }[]>`
    WITH old AS (
      SELECT id, stock_quantity FROM product_variants WHERE id = ${variantId}::uuid FOR UPDATE
    )
    UPDATE product_variants p
    SET stock_quantity = p.stock_quantity - LEAST(old.stock_quantity, ${quantity}::int),
        updated_at = now()
    FROM old WHERE p.id = old.id
    RETURNING old.stock_quantity AS before, p.stock_quantity AS after`;
  return row ?? null;
}

// Never touches stock. Callers make sure Stripe can no longer take the money first: the session
// expired or failed at Stripe, or the order never got a session. Returns false when the order
// had already left pending_payment.
export async function markExpired(tx: Tx, orderId: string, reason: string): Promise<boolean> {
  const moved = await tx.$executeRaw`
    UPDATE orders SET status = 'expired', expired_at = now(), updated_at = now()
    WHERE id = ${orderId}::uuid AND status = 'pending_payment'`;
  if (moved === 0) return false;
  // Frees any discount use (spec 0002); none exist until feature 14.
  await tx.discountRedemption.deleteMany({ where: { orderId } });
  await tx.orderEvent.create({
    data: {
      orderId,
      type: "status_changed",
      fromStatus: "pending_payment",
      toStatus: "expired",
      actorType: "system",
      message: reason,
    },
  });
  return true;
}

// spec 0010, AC-15: a payment that lands after the order left pending (an admin cancelled it, or
// it expired) is never silently kept. markPaid already refused it; this flags the order and
// says why. Returns false for any other status, where the payment is the order's own.
export async function flagLatePayment(tx: Tx, orderId: string): Promise<boolean> {
  const flagged = await tx.$executeRaw`
    UPDATE orders SET needs_attention = true, updated_at = now()
    WHERE id = ${orderId}::uuid AND status IN ('cancelled', 'expired')`;
  if (flagged === 0) return false;
  await tx.orderEvent.create({
    data: {
      orderId,
      type: "note",
      actorType: "system",
      message: "Payment received after the order left pending; refund it",
    },
  });
  return true;
}

// ─── Admin transitions (spec 0010) ───────────────────────────────────────────

type AdminMove = { readonly orderId: string; readonly adminId: string };

async function statusEvent(
  tx: Tx,
  move: AdminMove,
  fromStatus: OrderStatus,
  toStatus: OrderStatus,
  message: string | null,
) {
  await tx.orderEvent.create({
    data: {
      orderId: move.orderId,
      type: "status_changed",
      fromStatus,
      toStatus,
      actorType: "admin",
      adminId: move.adminId,
      message,
    },
  });
}

// AC-4: "Carrier: DHL, tracking: 123", with only the parts that were given.
export function shippingMessage(carrier: string | null, trackingNumber: string | null) {
  const parts = [
    carrier === null ? null : `Carrier: ${carrier}`,
    trackingNumber === null ? null : `tracking: ${trackingNumber}`,
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export async function markShipped(
  tx: Tx,
  move: AdminMove & { readonly carrier: string | null; readonly trackingNumber: string | null },
): Promise<boolean> {
  const moved = await tx.$executeRaw`
    UPDATE orders
    SET status = 'shipped', shipped_at = now(), carrier = ${move.carrier},
        tracking_number = ${move.trackingNumber}, updated_at = now()
    WHERE id = ${move.orderId}::uuid AND status = 'paid'`;
  if (moved === 0) return false;
  await statusEvent(
    tx,
    move,
    "paid",
    "shipped",
    shippingMessage(move.carrier, move.trackingNumber),
  );
  return true;
}

export async function markDelivered(tx: Tx, move: AdminMove): Promise<boolean> {
  const moved = await tx.$executeRaw`
    UPDATE orders SET status = 'delivered', delivered_at = now(), updated_at = now()
    WHERE id = ${move.orderId}::uuid AND status = 'shipped'`;
  if (moved === 0) return false;
  await statusEvent(tx, move, "shipped", "delivered", null);
  return true;
}

// AC-6: carrier and tracking stay, so shipping again prefills them.
export async function revertShipped(
  tx: Tx,
  move: AdminMove & { readonly reason: string },
): Promise<boolean> {
  const moved = await tx.$executeRaw`
    UPDATE orders SET status = 'paid', shipped_at = NULL, updated_at = now()
    WHERE id = ${move.orderId}::uuid AND status = 'shipped'`;
  if (moved === 0) return false;
  await statusEvent(tx, move, "shipped", "paid", move.reason);
  return true;
}

export async function revertDelivered(
  tx: Tx,
  move: AdminMove & { readonly reason: string },
): Promise<boolean> {
  const moved = await tx.$executeRaw`
    UPDATE orders SET status = 'shipped', delivered_at = NULL, updated_at = now()
    WHERE id = ${move.orderId}::uuid AND status = 'delivered'`;
  if (moved === 0) return false;
  await statusEvent(tx, move, "delivered", "shipped", move.reason);
  return true;
}

// AC-14 and AC-15. A paid order is only cancelled in the transaction that reserves its refund;
// a pending one only once Stripe can no longer take its money. Cancelling a pending order frees
// its discount use, as expiry does.
export async function markCancelled(
  tx: Tx,
  move: AdminMove & { readonly from: "paid" | "pending_payment"; readonly reason: string },
): Promise<boolean> {
  const moved =
    move.from === "paid"
      ? await tx.$executeRaw`
          UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now()
          WHERE id = ${move.orderId}::uuid AND status = 'paid'`
      : await tx.$executeRaw`
          UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now()
          WHERE id = ${move.orderId}::uuid AND status = 'pending_payment'`;
  if (moved === 0) return false;
  if (move.from === "pending_payment") {
    await tx.discountRedemption.deleteMany({ where: { orderId: move.orderId } });
  }
  await statusEvent(tx, move, move.from, "cancelled", move.reason);
  return true;
}

export const cancelUndoneMessage = "Cancel undone: Stripe refused the refund";

// AC-14: the only way out of cancelled. Stripe refused the refund reserved with the cancel, so
// the order still holds the money and goes back to paid.
export async function revertCancelled(tx: Tx, move: AdminMove): Promise<boolean> {
  const moved = await tx.$executeRaw`
    UPDATE orders SET status = 'paid', cancelled_at = NULL, updated_at = now()
    WHERE id = ${move.orderId}::uuid AND status = 'cancelled'`;
  if (moved === 0) return false;
  await statusEvent(tx, move, "cancelled", "paid", cancelUndoneMessage);
  return true;
}
