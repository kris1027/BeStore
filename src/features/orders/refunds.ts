import "server-only";

import type Stripe from "stripe";
import { z } from "zod";

import type { RefundStatus } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { recordMovements } from "@/lib/stock-movements";
import { stripe } from "@/lib/stripe";

import { refundOutcome } from "./event-decision";
import {
  logRefundFailed,
  logRefundLateFailure,
  logRefundRestocked,
  logRefundRestockSkipped,
  logRefundSucceeded,
  logRefundUnknownStatus,
  logSystemRefundRecorded,
} from "./log";
import { type LockedOrder, lockOrderById } from "./order-lock";
import { allocateReturns } from "./refund-math";

// Refunds in three steps (spec 0010, Refund flow): reserveRefund records a pending refund under
// the order row lock, requestStripeRefund calls Stripe with no transaction open, and
// applyRefundOutcome settles the row. The action's reply, the webhook and the sync all settle
// through applyRefundOutcome, which only ever moves a row out of the status it read under lock,
// so they can race and a refund is still counted and restocked once.

const uuid = z.uuid();

function money(cents: number, currency: string): string {
  return formatMoney(cents, { currency, locale: env.STORE_LOCALE });
}

async function touchOrder(tx: Tx, orderId: string) {
  await tx.$executeRaw`UPDATE orders SET updated_at = now() WHERE id = ${orderId}::uuid`;
}

async function flagOrder(tx: Tx, orderId: string) {
  await tx.$executeRaw`
    UPDATE orders SET needs_attention = true, updated_at = now()
    WHERE id = ${orderId}::uuid AND NOT needs_attention`;
}

async function systemEvent(
  tx: Tx,
  orderId: string,
  type: "refund_created" | "refund_succeeded" | "refund_failed" | "note",
  message: string,
) {
  await tx.orderEvent.create({ data: { orderId, type, actorType: "system", message } });
}

// ─── Step 1: reserve ─────────────────────────────────────────────────────────

export type RefundReservation = {
  readonly order: LockedOrder;
  readonly adminId: string;
  readonly amountCents: number;
  readonly reason: string;
  readonly includesShipping: boolean;
  readonly lines: readonly {
    readonly orderLineId: string;
    readonly quantity: number;
    readonly restock: boolean;
  }[];
};

// Runs inside the transaction that locked the order and checked the request. The pending row
// reserves the money: every later check counts it until it fails.
export async function reserveRefund(tx: Tx, input: RefundReservation): Promise<string> {
  const refund = await tx.refund.create({
    data: {
      orderId: input.order.id,
      amountCents: input.amountCents,
      reason: input.reason,
      status: "pending",
      actorType: "admin",
      adminId: input.adminId,
      includesShipping: input.includesShipping,
      lines: {
        create: input.lines.map((line) => ({
          orderLineId: line.orderLineId,
          quantity: line.quantity,
          restock: line.restock,
        })),
      },
    },
    select: { id: true },
  });
  await tx.orderEvent.create({
    data: {
      orderId: input.order.id,
      type: "refund_created",
      actorType: "admin",
      adminId: input.adminId,
      message: `Refund of ${money(input.amountCents, input.order.currency)}. Reason: ${input.reason}`,
    },
  });
  await touchOrder(tx, input.order.id);
  return refund.id;
}

// ─── Step 2: ask Stripe ──────────────────────────────────────────────────────

export type RefundReport = {
  readonly stripeRefundId: string | null;
  // Stripe's own status text; refundOutcome decides what it means.
  readonly status: string | null;
  readonly failureMessage: string | null;
  // The Stripe event's time on the webhook path; null means now().
  readonly at: Date | null;
};

export type StripeAnswer =
  | { readonly kind: "answered"; readonly report: RefundReport }
  // A 4xx the request could not have survived: no refund exists at Stripe (AC-12).
  | {
      readonly kind: "refused";
      readonly message: string;
      readonly errorType: string;
      readonly stripeCode: string | null;
    }
  // Anything else: the refund may exist, so the row stays pending for the sync.
  | { readonly kind: "unknown"; readonly errorType: string };

// StripeIdempotencyError is not here: a 409 "key in use" means our first request with this key
// is still running at Stripe and may yet create the refund, so it is unknown, not refused.
const refusedErrorTypes: ReadonlySet<string> = new Set([
  "StripeInvalidRequestError",
  "StripePermissionError",
  "StripeAuthenticationError",
  "StripeCardError",
]);

export function reportOf(refund: Stripe.Refund, at: Date | null = null): RefundReport {
  return {
    stripeRefundId: refund.id,
    status: refund.status,
    failureMessage: refund.failure_reason ?? null,
    at,
  };
}

export function classifyStripeError(error: unknown): Exclude<StripeAnswer, { kind: "answered" }> {
  const errorType =
    typeof error === "object" && error !== null && "type" in error && typeof error.type === "string"
      ? error.type
      : error instanceof Error
        ? error.name
        : "unknown";
  if (!refusedErrorTypes.has(errorType)) return { kind: "unknown", errorType };
  const message =
    error instanceof Error && error.message !== "" ? error.message : "No message from Stripe";
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  return { kind: "refused", message, errorType, stripeCode: code };
}

// Never inside a transaction. The refund id is the idempotency key, so a retry (the SDK's own,
// or a later sync) can never refund twice. Stripe gets ids only, never the admin's reason.
export async function requestStripeRefund(input: {
  readonly refundId: string;
  readonly orderId: string;
  readonly orderNumber: number;
  readonly paymentIntentId: string;
  readonly amountCents: number;
}): Promise<StripeAnswer> {
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountCents,
        reason: "requested_by_customer",
        metadata: {
          refund_id: input.refundId,
          order_id: input.orderId,
          order_number: String(input.orderNumber),
        },
      },
      { idempotencyKey: input.refundId },
    );
    return { kind: "answered", report: reportOf(refund) };
  } catch (error) {
    return classifyStripeError(error);
  }
}

// ─── Step 3: settle ──────────────────────────────────────────────────────────

// Where an outcome came from. Only a failure Stripe reported later (webhook, sync) flags the
// order (AC-17).
export type OutcomeSource = "action" | "webhook" | "sync";

export type AppliedOutcome = {
  readonly refundId: string;
  readonly orderId: string;
  readonly orderNumber: number;
  readonly amountCents: number;
  readonly from: RefundStatus;
  readonly to: RefundStatus;
  // Product slugs whose storefront cache must expire once the transaction commits.
  readonly productSlugs: readonly string[];
};

type RefundRow = {
  id: string;
  order_id: string;
  status: RefundStatus;
  amount_cents: number;
  stripe_refund_id: string | null;
  admin_id: string | null;
};

// The refund row a Stripe refund belongs to, on an order the caller already locked: our row
// with that Stripe id, else the row our metadata names (a request whose answer was lost).
export async function findRefundRow(
  tx: Tx,
  orderId: string,
  stripeRefundId: string,
  metadataRefundId: unknown,
): Promise<string | null> {
  const byStripe = await tx.refund.findFirst({
    where: { orderId, stripeRefundId },
    select: { id: true },
  });
  if (byStripe) return byStripe.id;
  const ours = uuid.safeParse(metadataRefundId);
  if (!ours.success) return null;
  const byMetadata = await tx.refund.findFirst({
    where: { id: ours.data, orderId, stripeRefundId: null },
    select: { id: true },
  });
  return byMetadata?.id ?? null;
}

// One function for the action's reply, the webhook and the sync (spec 0010, Refund outcomes).
// Locks the order, then the refund, and applies the table; a repeat of the stored state changes
// nothing. Returns null when the refund row does not exist.
export async function applyRefundOutcome(
  tx: Tx,
  refundId: string,
  report: RefundReport,
  source: OutcomeSource,
): Promise<AppliedOutcome | null> {
  const owner = await tx.refund.findUnique({ where: { id: refundId }, select: { orderId: true } });
  if (!owner) return null;
  const order = await lockOrderById(tx, owner.orderId);
  if (!order) return null;
  const [row] = await tx.$queryRaw<RefundRow[]>`
    SELECT id, order_id, status, amount_cents, stripe_refund_id, admin_id
    FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
  if (!row) return null;

  const base = {
    refundId: row.id,
    orderId: order.id,
    orderNumber: order.number,
    amountCents: row.amount_cents,
    from: row.status,
  };
  const savesStripeId = row.stripe_refund_id === null && report.stripeRefundId !== null;
  if (savesStripeId) {
    await tx.refund.update({
      where: { id: row.id },
      data: { stripeRefundId: report.stripeRefundId },
    });
  }

  const effect = await applyOutcomeTable(tx, order, row, report, source);
  if (savesStripeId || effect.to !== row.status) await touchOrder(tx, order.id);
  return { ...base, ...effect };
}

type Effect = { readonly to: RefundStatus; readonly productSlugs: readonly string[] };

// The rows of the Refund outcomes table. Returns where the refund ended and which products'
// cache must expire; a repeat of the stored state changes nothing.
async function applyOutcomeTable(
  tx: Tx,
  order: LockedOrder,
  row: RefundRow,
  report: RefundReport,
  source: OutcomeSource,
): Promise<Effect> {
  const unchanged: Effect = { to: row.status, productSlugs: [] };
  const logFields = { orderId: order.id, refundId: row.id, amountCents: row.amount_cents };
  const amount = money(row.amount_cents, order.currency);
  const outcome = refundOutcome(report.status);

  if (outcome === "unknown") {
    // Kept as it is (pending stays pending) and flagged once, never guessed.
    const already = await tx.orderEvent.count({
      where: { orderId: order.id, type: "note", message: unknownStatusMessage(report.status) },
    });
    if (already === 0) {
      await flagOrder(tx, order.id);
      await systemEvent(tx, order.id, "note", unknownStatusMessage(report.status));
      logRefundUnknownStatus({ ...logFields, stripeStatus: report.status });
    }
    return unchanged;
  }

  if (row.status === "pending" && outcome === "succeeded") {
    const productSlugs = await markSucceeded(tx, order, row, report.at, amount);
    logRefundSucceeded(logFields);
    return { to: "succeeded", productSlugs };
  }

  if (row.status === "pending" && outcome === "failed") {
    await setStatus(tx, row.id, "failed", null);
    const reason = report.failureMessage ?? "no reason given";
    await systemEvent(tx, order.id, "refund_failed", `Refund of ${amount} failed: ${reason}`);
    // The action's own failure is shown to the admin who is looking at the order; one Stripe
    // reported later (webhook, sync) needs a person to notice it.
    if (source === "action") logRefundFailed({ ...logFields, from: "pending" });
    else {
      await flagOrder(tx, order.id);
      logRefundLateFailure({ ...logFields, from: "pending" });
    }
    return { to: "failed", productSlugs: [] };
  }

  if (row.status === "succeeded" && outcome === "failed") {
    // Stripe can fail a refund it already reported succeeded (a closed card). The money did
    // not go back, so it no longer counts; stock it returned stays, a person adjusts it.
    await setStatus(tx, row.id, "failed", null);
    await recountRefunded(tx, order);
    await systemEvent(
      tx,
      order.id,
      "refund_failed",
      `Refund of ${amount} failed after succeeding; stock it returned was kept`,
    );
    await flagOrder(tx, order.id);
    logRefundLateFailure({ ...logFields, from: "succeeded" });
    return { to: "failed", productSlugs: [] };
  }

  if (row.status === "failed" && outcome !== "failed") {
    // We marked it failed but Stripe processed it (a request whose answer was lost).
    const productSlugs =
      outcome === "succeeded"
        ? await markSucceeded(tx, order, row, report.at, amount)
        : await setStatus(tx, row.id, "pending", null).then(() => []);
    if (outcome === "succeeded") logRefundSucceeded(logFields);
    await flagOrder(tx, order.id);
    await systemEvent(
      tx,
      order.id,
      "note",
      "Stripe processed a refund the store had marked failed",
    );
    return { to: outcome, productSlugs };
  }

  return unchanged;
}

function unknownStatusMessage(status: string | null) {
  return `Stripe reports a refund status this store does not know (${status ?? "none"}). Check the refund in the Stripe dashboard.`;
}

async function setStatus(tx: Tx, refundId: string, status: RefundStatus, succeededAt: Date | null) {
  if (status === "succeeded") {
    await tx.$executeRaw`
      UPDATE refunds SET status = 'succeeded', succeeded_at = COALESCE(${succeededAt}, now()),
                         updated_at = now()
      WHERE id = ${refundId}::uuid`;
    return;
  }
  await tx.refund.update({ where: { id: refundId }, data: { status, succeededAt: null } });
}

async function markSucceeded(
  tx: Tx,
  order: LockedOrder,
  row: RefundRow,
  at: Date | null,
  amount: string,
): Promise<readonly string[]> {
  await setStatus(tx, row.id, "succeeded", at);
  await recountRefunded(tx, order);
  await systemEvent(tx, order.id, "refund_succeeded", `Refund of ${amount} succeeded`);
  return row.admin_id === null ? [] : restockRefund(tx, order.id, row.id, row.admin_id);
}

// refunded_cents is the sum of succeeded refunds, capped at the total by its CHECK. Over the
// total (a dashboard refund racing a pending admin one) the refunds keep their true status, the
// order is flagged and the overflow noted (spec 0010, Refund outcomes).
async function recountRefunded(tx: Tx, order: LockedOrder) {
  const sum = await tx.refund.aggregate({
    where: { orderId: order.id, status: "succeeded" },
    _sum: { amountCents: true },
  });
  const succeeded = sum._sum.amountCents ?? 0;
  const refunded = Math.min(succeeded, order.totalCents);
  await tx.$executeRaw`
    UPDATE orders SET refunded_cents = ${refunded}, updated_at = now()
    WHERE id = ${order.id}::uuid`;
  if (succeeded > order.totalCents) {
    await flagOrder(tx, order.id);
    await systemEvent(
      tx,
      order.id,
      "note",
      `Refunds total ${money(succeeded, order.currency)}, more than the order total of ${money(order.totalCents, order.currency)}. Check the refunds in the Stripe dashboard.`,
    );
  }
}

type RestockLine = {
  id: string;
  quantity: number;
  order_line_id: string;
  variant_id: string | null;
  product_id: string | null;
  sku: string;
};

// AC-13: puts back what the refund asked for, capped per variant at what the sale took minus
// what earlier refunds returned, lowest order line first. Variants are locked in id order, as
// markPaid locks them. Runs in the transaction that marks the refund succeeded.
export async function restockRefund(
  tx: Tx,
  orderId: string,
  refundId: string,
  adminId: string,
): Promise<readonly string[]> {
  const lines = await tx.$queryRaw<RestockLine[]>`
    SELECT rl.id, rl.quantity, rl.order_line_id, ol.variant_id, ol.product_id, ol.sku
    FROM refund_lines rl JOIN order_lines ol ON ol.id = rl.order_line_id
    WHERE rl.refund_id = ${refundId}::uuid AND rl.restock AND NOT rl.restocked
    ORDER BY ol.variant_id NULLS LAST, ol.id`;

  const byVariant = new Map<string, RestockLine[]>();
  for (const line of lines) {
    if (line.variant_id === null) {
      await systemEvent(
        tx,
        orderId,
        "note",
        `${line.sku} no longer exists, so it was not returned to stock`,
      );
      logRefundRestockSkipped({ orderId, refundId, orderLineId: line.order_line_id });
      continue;
    }
    byVariant.set(line.variant_id, [...(byVariant.get(line.variant_id) ?? []), line]);
  }

  const productIds = new Set<string>();
  for (const [variantId, variantLines] of byVariant) {
    const [variant] = await tx.$queryRaw<{ stock_quantity: number }[]>`
      SELECT stock_quantity FROM product_variants WHERE id = ${variantId}::uuid FOR UPDATE`;
    if (!variant) {
      for (const line of variantLines) {
        await systemEvent(
          tx,
          orderId,
          "note",
          `${line.sku} no longer exists, so it was not returned to stock`,
        );
        logRefundRestockSkipped({ orderId, refundId, orderLineId: line.order_line_id });
      }
      continue;
    }
    const [moved] = await tx.$queryRaw<{ taken: number; returned: number }[]>`
      SELECT COALESCE(-SUM(delta) FILTER (WHERE kind = 'sale'), 0)::int AS taken,
             COALESCE(SUM(delta) FILTER (WHERE kind = 'return'), 0)::int AS returned
      FROM stock_movements WHERE order_id = ${orderId}::uuid AND variant_id = ${variantId}::uuid`;
    const available = (moved?.taken ?? 0) - (moved?.returned ?? 0);
    const allocation = allocateReturns(
      available,
      variantLines.map((line) => ({ id: line.order_line_id, quantity: line.quantity })),
    );

    let total = 0;
    for (const line of variantLines) {
      const returned = allocation.find((entry) => entry.id === line.order_line_id)?.returned ?? 0;
      total += returned;
      if (returned > 0) {
        await tx.refundLine.update({
          where: { id: line.id },
          data: { returnedQuantity: returned, restocked: true },
        });
      }
      if (returned < line.quantity) {
        await systemEvent(
          tx,
          orderId,
          "note",
          `Returned ${returned} of ${line.quantity} to stock for ${line.sku}`,
        );
      }
      if (line.product_id !== null && returned > 0) productIds.add(line.product_id);
    }
    if (total === 0) continue;

    const [after] = await tx.$queryRaw<{ stock_quantity: number }[]>`
      UPDATE product_variants SET stock_quantity = stock_quantity + ${total}, updated_at = now()
      WHERE id = ${variantId}::uuid RETURNING stock_quantity`;
    if (!after) throw new Error(`Variant ${variantId} vanished under its row lock`);
    await recordMovements(tx, [
      {
        kind: "return",
        variantId,
        delta: total,
        stockAfter: after.stock_quantity,
        orderId,
        adminId,
      },
    ]);
    logRefundRestocked({
      orderId,
      refundId,
      variantId,
      returned: total,
      requested: variantLines.reduce((sum, line) => sum + line.quantity, 0),
    });
  }

  if (productIds.size === 0) return [];
  const products = await tx.product.findMany({
    where: { id: { in: [...productIds] } },
    select: { slug: true },
  });
  return products.map((product) => product.slug);
}

// ─── Refunds made outside the store (AC-16) ──────────────────────────────────

// A refund on our order's payment that no row of ours matches (made in the Stripe dashboard):
// recorded with no lines and no restock, in whatever state Stripe reports. The caller has locked
// the order. Counts toward refunded_cents only once it succeeded.
export async function recordSystemRefund(
  tx: Tx,
  order: LockedOrder,
  refund: Stripe.Refund,
  at: Date,
): Promise<AppliedOutcome> {
  const outcome = refundOutcome(refund.status);
  const status: RefundStatus = outcome === "unknown" ? "pending" : outcome;
  const created = await tx.refund.create({
    data: {
      orderId: order.id,
      amountCents: refund.amount,
      reason: refund.reason ?? null,
      status,
      stripeRefundId: refund.id,
      actorType: "system",
      succeededAt: status === "succeeded" ? at : null,
    },
    select: { id: true },
  });
  const amount = money(refund.amount, order.currency);
  await systemEvent(tx, order.id, "refund_created", `Refund of ${amount} made in Stripe`);
  if (status === "succeeded") {
    await recountRefunded(tx, order);
    await systemEvent(tx, order.id, "refund_succeeded", `Refund of ${amount} succeeded`);
  }
  if (status === "failed") {
    await systemEvent(
      tx,
      order.id,
      "refund_failed",
      `Refund of ${amount} failed: ${refund.failure_reason ?? "no reason given"}`,
    );
  }
  if (outcome === "unknown") {
    await flagOrder(tx, order.id);
    await systemEvent(tx, order.id, "note", unknownStatusMessage(refund.status));
    logRefundUnknownStatus({
      orderId: order.id,
      refundId: created.id,
      stripeStatus: refund.status,
    });
  }
  await touchOrder(tx, order.id);
  logSystemRefundRecorded({
    orderId: order.id,
    refundId: created.id,
    amountCents: refund.amount,
    status,
  });
  return {
    refundId: created.id,
    orderId: order.id,
    orderNumber: order.number,
    amountCents: refund.amount,
    from: status,
    to: status,
    productSlugs: [],
  };
}
