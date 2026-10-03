import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { type MovementRow, recordMovements } from "@/lib/stock-movements";

// The only code that changes orders.status (spec 0006, State transitions). Both functions run
// inside the caller's transaction and move an order only while it is still pending_payment:
// zero rows updated means another path already moved it, so they do nothing else.

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
