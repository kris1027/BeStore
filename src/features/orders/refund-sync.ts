import "server-only";

import type Stripe from "stripe";

import type { RefundStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";

import { logReconcileRefundFailed, type RefundSyncCounts } from "./log";
import { type AppliedOutcome, applyRefundOutcome, type RefundReport, reportOf } from "./refunds";

// spec 0010, AC-17: asks Stripe what became of a pending refund and settles it through the same
// applyRefundOutcome as the action and the webhook. Run by the reconcile cron and the order
// page's "Check with Stripe" button.

// Stripe keeps an idempotency key for 24 hours. A request it never saw by then can no longer
// land as a retry of ours, so the refund is failed for good.
export const NEVER_REACHED_AFTER_MS = 24 * 60 * 60 * 1000;
export const neverReachedMessage = "Request never reached Stripe";

export const REFUND_SYNC_BATCH = 100;

export type SyncResult = {
  readonly status: RefundStatus;
  // Set when this sync changed the row (or saved its Stripe id).
  readonly applied: AppliedOutcome | null;
};

// Throws on a Stripe or database error; callers decide what that means for them.
export async function syncRefund(refundId: string, nowMs: number): Promise<SyncResult | null> {
  const refund = await db.refund.findUnique({
    where: { id: refundId },
    select: {
      status: true,
      stripeRefundId: true,
      createdAt: true,
      order: { select: { stripePaymentIntentId: true } },
    },
  });
  if (!refund) return null;
  if (refund.status !== "pending") return { status: refund.status, applied: null };

  let report: RefundReport | null = null;
  if (refund.stripeRefundId !== null) {
    report = reportOf(await stripe.refunds.retrieve(refund.stripeRefundId));
  } else if (refund.order.stripePaymentIntentId !== null) {
    const found = await findByMetadata(refund.order.stripePaymentIntentId, refundId);
    report = found === null ? null : reportOf(found);
  }
  if (report === null) {
    if (nowMs - refund.createdAt.getTime() < NEVER_REACHED_AFTER_MS) {
      return { status: "pending", applied: null };
    }
    report = {
      stripeRefundId: null,
      status: "failed",
      failureMessage: neverReachedMessage,
      at: null,
    };
  }

  const settled = report;
  const applied = await db.$transaction((tx) => applyRefundOutcome(tx, refundId, settled, "sync"));
  return applied === null ? null : { status: applied.to, applied };
}

// A request whose answer was lost has no Stripe id on our row: find it among the payment's
// refunds by the refund id we sent as metadata, following every page.
async function findByMetadata(
  paymentIntentId: string,
  refundId: string,
): Promise<Stripe.Refund | null> {
  for await (const refund of stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 })) {
    if (refund.metadata?.refund_id === refundId) return refund;
  }
  return null;
}

// The cron's part: the oldest pending refunds first, at most a batch, inside the run's time
// budget. One refund's error is logged and skipped, so it cannot stall the rest.
export async function syncPendingRefunds(
  nowMs: number,
  options: { readonly limit?: number; readonly deadlineMs?: number } = {},
): Promise<RefundSyncCounts & { readonly productSlugs: readonly string[] }> {
  const pending = await db.refund.findMany({
    where: { status: "pending" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: options.limit ?? REFUND_SYNC_BATCH,
    select: { id: true },
  });

  const counts = { checked: 0, settled: 0, failed: 0, skipped: 0 };
  const productSlugs = new Set<string>();
  for (const { id } of pending) {
    if (options.deadlineMs !== undefined && Date.now() > options.deadlineMs) break;
    counts.checked += 1;
    try {
      const result = await syncRefund(id, nowMs);
      if (result?.applied && result.applied.to !== result.applied.from) {
        counts.settled += 1;
        for (const slug of result.applied.productSlugs) productSlugs.add(slug);
      }
    } catch (error) {
      logReconcileRefundFailed(id, error);
      counts.failed += 1;
      counts.skipped += 1;
    }
  }
  return { ...counts, productSlugs: [...productSlugs] };
}
