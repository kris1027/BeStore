import "server-only";

import { revalidatePath, updateTag } from "next/cache";

import { catalogTag, productTag } from "@/lib/cache-tags";
import { db, type Tx } from "@/lib/db";

import { logOrderAdminEvent } from "../admin-log";
import { refundOutcome } from "../event-decision";
import { logRefundStripeRefused, logRefundStripeUnavailable } from "../log";
import type { OrderActionError } from "../messages";
import type { LockedOrder } from "../order-lock";
import { adminOrderPath } from "../paths";
import { applyRefundOutcome, requestStripeRefund, type StripeAnswer } from "../refunds";

// Steps 2 and 3 of the refund flow as refundOrder and the paid cancel both run them, after
// step 1 reserved the refund under the order lock (spec 0010, Refund flow).

// A refund recorded pending and committed, ready for Stripe.
export type Reserved = {
  readonly order: LockedOrder;
  readonly paymentIntentId: string;
  readonly refundId: string;
  readonly amountCents: number;
};

export type Settled = {
  readonly status: "pending" | "succeeded" | "failed";
  readonly productSlugs: readonly string[];
  // The request failed and the caller's onFailure changed something (the cancel undid itself).
  readonly undone: boolean;
};

// Step 2: logs the reserved refund and asks Stripe for it, with no transaction open.
export async function sendToStripe(adminId: string, reserved: Reserved): Promise<StripeAnswer> {
  const { order, refundId, amountCents, paymentIntentId } = reserved;
  logOrderAdminEvent("refund.created", {
    adminId,
    orderId: order.id,
    number: order.number,
    refundId,
    amountCents,
  });
  return requestStripeRefund({
    refundId,
    orderId: order.id,
    orderNumber: order.number,
    paymentIntentId,
    amountCents,
  });
}

// Step 3, after Stripe answered (or did not). Returns the refund's status now; a lost answer
// leaves it pending for the sync. `onFailure` runs in the same transaction when the request
// itself failed, and answers whether it changed anything.
async function settle(
  reserved: Reserved,
  answer: StripeAnswer,
  onFailure?: (tx: Tx) => Promise<boolean>,
): Promise<Settled> {
  if (answer.kind === "unknown") return { status: "pending", productSlugs: [], undone: false };
  const report =
    answer.kind === "answered"
      ? answer.report
      : { stripeRefundId: null, status: "failed", failureMessage: answer.message, at: null };
  const requestFailed = answer.kind === "refused" || refundOutcome(report.status) === "failed";

  return db.$transaction(async (tx) => {
    const applied = await applyRefundOutcome(tx, reserved.refundId, report, "action");
    // The webhook may have settled it first; the row says where it is now either way.
    const row = await tx.refund.findUniqueOrThrow({
      where: { id: reserved.refundId },
      select: { status: true },
    });
    const undone =
      requestFailed && row.status === "failed" && onFailure ? await onFailure(tx) : false;
    return { status: row.status, productSlugs: applied?.productSlugs ?? [], undone };
  });
}

// Stripe may already have the money moving, so a database error here must not hide that: the
// refund stays pending and the sync settles it.
export async function settleOrPending(
  reserved: Reserved,
  answer: StripeAnswer,
  onFailure?: (tx: Tx) => Promise<boolean>,
): Promise<Settled> {
  try {
    return await settle(reserved, answer, onFailure);
  } catch (error) {
    logRefundStripeUnavailable({
      orderId: reserved.order.id,
      refundId: reserved.refundId,
      amountCents: reserved.amountCents,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { status: "pending", productSlugs: [], undone: false };
  }
}

// After commit: the storefront products a restock touched, and the order page.
export function expireAfterRefund(orderNumber: number, productSlugs: readonly string[]) {
  if (productSlugs.length > 0) {
    updateTag(catalogTag);
    for (const slug of productSlugs) updateTag(productTag(slug));
  }
  revalidatePath(adminOrderPath(orderNumber));
}

// What the admin is told about Stripe's answer, or null when the refund went through or waits.
export function answerError(
  answer: StripeAnswer,
  reserved: Reserved,
  settled: Settled,
): OrderActionError | null {
  const fields = {
    orderId: reserved.order.id,
    refundId: reserved.refundId,
    amountCents: reserved.amountCents,
  };
  if (answer.kind === "refused") {
    logRefundStripeRefused({
      ...fields,
      errorType: answer.errorType,
      stripeCode: answer.stripeCode,
    });
    return { code: "stripe_refused", message: answer.message };
  }
  if (answer.kind === "unknown") {
    logRefundStripeUnavailable({ ...fields, errorType: answer.errorType });
    return { code: "stripe_unavailable", refundPending: true };
  }
  if (settled.status === "failed") {
    return {
      code: "stripe_refused",
      message: answer.report.failureMessage ?? "the refund failed",
    };
  }
  return null;
}
