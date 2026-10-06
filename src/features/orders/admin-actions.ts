"use server";

import { revalidatePath, updateTag } from "next/cache";
import type Stripe from "stripe";
import type { z } from "zod";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import type { OrderStatus } from "@/generated/prisma/client";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db, type Tx } from "@/lib/db";
import { parseMoney } from "@/lib/money";
import { sessionState } from "@/lib/orders/session-state";
import * as transitions from "@/lib/orders/transitions";
import type { ActionResult } from "@/lib/result";
import { stripe } from "@/lib/stripe";

import { refundOutcome } from "./event-decision";
import { logOrderAdminEvent } from "./admin-log";
import { logRefundStripeRefused, logRefundStripeUnavailable } from "./log";
import { nothingChangedMessage, type OrderActionError } from "./messages";
import { canCheckWithStripe, type OrderAction, statusAllows } from "./order-actions";
import {
  hasRefundInFlight,
  isStale,
  type LockedOrder,
  loadMathOrder,
  lockOrderByNumber,
} from "./order-lock";
import { adminOrderPath } from "./paths";
import { cancelPlan, type MathOrder, refundRequestErrors, remainingCents } from "./refund-math";
import { syncRefund } from "./refund-sync";
import {
  type AppliedOutcome,
  applyRefundOutcome,
  requestStripeRefund,
  reserveRefund,
  type StripeAnswer,
} from "./refunds";
import {
  cancelSchema,
  checkRefundSchema,
  noteSchema,
  orderOnlySchema,
  pathErrors,
  reasonSchema,
  refundSchema,
  resolveSchema,
  trackingSchema,
} from "./schemas";

// The admin order actions (spec 0010, API surface). Each calls requireAdmin() itself, parses its
// input with Zod, then locks the order row and checks, in this order (AC-8): the form is not
// stale, no refund is in flight (AC-18), and the status allows the action. Amounts always come
// from the order's rows; the client's amount is only checked against them.

type Result<T> = Promise<ActionResult<T, OrderActionError>>;

type Guarded = { readonly order: LockedOrder; readonly math: MathOrder };

function invalidInput(error: z.ZodError): { ok: false; error: OrderActionError } {
  return { ok: false, error: { code: "invalid_input", fields: pathErrors(error) } };
}

function isError(value: object): value is OrderActionError {
  return "code" in value;
}

// Locks the order and runs the AC-8 checks. A stale or moved order is logged as
// order.action_stale (the order number and action only).
async function guard(
  tx: Tx,
  input: { readonly orderNumber: number; readonly expectedUpdatedAt: string },
  action: OrderAction,
): Promise<Guarded | OrderActionError> {
  const order = await lockOrderByNumber(tx, input.orderNumber);
  if (!order) return { code: "not_found" };
  if (isStale(order, input.expectedUpdatedAt)) return { code: "stale" };
  if (await hasRefundInFlight(tx, order.id, Date.now())) return { code: "refund_in_progress" };
  const math = await loadMathOrder(tx, order);
  const allowed = statusAllows(action, {
    status: order.status,
    needsAttention: order.needsAttention,
    remainingCents: remainingCents(math),
    refundInFlight: false,
  });
  return allowed ? { order, math } : { code: "invalid_transition" };
}

function refused<T>(
  adminId: string,
  orderNumber: number,
  action: OrderAction,
  error: OrderActionError,
): ActionResult<T, OrderActionError> {
  if (error.code === "stale" || error.code === "invalid_transition") {
    logOrderAdminEvent("order.action_stale", {
      adminId,
      number: orderNumber,
      action,
      reason: error.code,
    });
  }
  return { ok: false, error };
}

// ─── Status ──────────────────────────────────────────────────────────────────

// AC-4.
export async function markShipped(input: unknown): Result<{ readonly status: OrderStatus }> {
  const admin = await requireAdmin();
  const parsed = trackingSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { carrier, trackingNumber, orderNumber } = parsed.data;

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "ship");
    if (isError(guarded)) return guarded;
    const moved = await transitions.markShipped(tx, {
      orderId: guarded.order.id,
      adminId: admin.id,
      carrier,
      trackingNumber,
    });
    return moved ? guarded.order : ({ code: "invalid_transition" } as const);
  });
  if (isError(outcome)) return refused(admin.id, orderNumber, "ship", outcome);

  logOrderAdminEvent("order.shipped", {
    adminId: admin.id,
    orderId: outcome.id,
    number: outcome.number,
  });
  return { ok: true, data: { status: "shipped" } };
}

// AC-5.
export async function markDelivered(input: unknown): Result<{ readonly status: OrderStatus }> {
  const admin = await requireAdmin();
  const parsed = orderOnlySchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "deliver");
    if (isError(guarded)) return guarded;
    const moved = await transitions.markDelivered(tx, {
      orderId: guarded.order.id,
      adminId: admin.id,
    });
    return moved ? guarded.order : ({ code: "invalid_transition" } as const);
  });
  if (isError(outcome)) return refused(admin.id, parsed.data.orderNumber, "deliver", outcome);

  logOrderAdminEvent("order.delivered", {
    adminId: admin.id,
    orderId: outcome.id,
    number: outcome.number,
  });
  return { ok: true, data: { status: "delivered" } };
}

// AC-6: one step back, shipped to paid or delivered to shipped, with a reason.
export async function undoStatus(input: unknown): Result<{ readonly status: OrderStatus }> {
  const admin = await requireAdmin();
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { reason } = parsed.data;

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "undo");
    if (isError(guarded)) return guarded;
    const { order } = guarded;
    const move = { orderId: order.id, adminId: admin.id, reason };
    const to: OrderStatus = order.status === "delivered" ? "shipped" : "paid";
    const moved =
      order.status === "delivered"
        ? await transitions.revertDelivered(tx, move)
        : await transitions.revertShipped(tx, move);
    return moved ? { order, to } : ({ code: "invalid_transition" } as const);
  });
  if (isError(outcome)) return refused(admin.id, parsed.data.orderNumber, "undo", outcome);

  logOrderAdminEvent("order.status_reverted", {
    adminId: admin.id,
    orderId: outcome.order.id,
    number: outcome.order.number,
    from: outcome.order.status,
    to: outcome.to,
  });
  return { ok: true, data: { status: outcome.to } };
}

// AC-7: "Carrier: A → B, tracking: X → Y", only the parts that changed.
export async function editTracking(input: unknown): Result<null> {
  const admin = await requireAdmin();
  const parsed = trackingSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { carrier, trackingNumber } = parsed.data;

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "editTracking");
    if (isError(guarded)) return guarded;
    const { order } = guarded;
    const show = (value: string | null) => value ?? "none";
    const parts = [
      order.carrier === carrier ? null : `Carrier: ${show(order.carrier)} → ${show(carrier)}`,
      order.trackingNumber === trackingNumber
        ? null
        : `tracking: ${show(order.trackingNumber)} → ${show(trackingNumber)}`,
    ].filter((part) => part !== null);
    if (parts.length === 0) {
      return {
        code: "invalid_input",
        fields: { root: [nothingChangedMessage] },
      } as const satisfies OrderActionError;
    }
    await tx.$executeRaw`
      UPDATE orders SET carrier = ${carrier}, tracking_number = ${trackingNumber},
                        updated_at = now()
      WHERE id = ${order.id}::uuid`;
    const text = parts.join(", ");
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "tracking_updated",
        actorType: "admin",
        adminId: admin.id,
        message: text.charAt(0).toUpperCase() + text.slice(1),
      },
    });
    return order;
  });
  if (isError(outcome)) {
    return refused(admin.id, parsed.data.orderNumber, "editTracking", outcome);
  }

  logOrderAdminEvent("order.tracking_updated", {
    adminId: admin.id,
    orderId: outcome.id,
    number: outcome.number,
  });
  return { ok: true, data: null };
}

// ─── Notes and the attention flag ────────────────────────────────────────────

// AC-19: any order, any status, no stale check (notes never conflict) and no updated_at bump.
export async function addNote(input: unknown): Result<{ readonly eventId: string }> {
  const admin = await requireAdmin();
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const order = await db.order.findUnique({
    where: { number: parsed.data.orderNumber },
    select: { id: true, number: true },
  });
  if (!order) return { ok: false, error: { code: "not_found" } };
  const event = await db.orderEvent.create({
    data: {
      orderId: order.id,
      type: "note",
      actorType: "admin",
      adminId: admin.id,
      message: parsed.data.note,
    },
    select: { id: true },
  });

  logOrderAdminEvent("order.note_added", {
    adminId: admin.id,
    orderId: order.id,
    number: order.number,
  });
  return { ok: true, data: { eventId: event.id } };
}

// AC-20.
export async function resolveAttention(input: unknown): Result<null> {
  const admin = await requireAdmin();
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "resolve");
    if (isError(guarded)) return guarded;
    const { order } = guarded;
    await tx.$executeRaw`
      UPDATE orders SET needs_attention = false, updated_at = now()
      WHERE id = ${order.id}::uuid`;
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "attention_cleared",
        actorType: "admin",
        adminId: admin.id,
        message: parsed.data.note,
      },
    });
    return order;
  });
  if (isError(outcome)) return refused(admin.id, parsed.data.orderNumber, "resolve", outcome);

  logOrderAdminEvent("order.attention_cleared", {
    adminId: admin.id,
    orderId: outcome.id,
    number: outcome.number,
  });
  return { ok: true, data: null };
}

// ─── Refunds ─────────────────────────────────────────────────────────────────

type Reserved = {
  readonly order: LockedOrder;
  readonly paymentIntentId: string;
  readonly refundId: string;
  readonly amountCents: number;
};

type Settled = {
  readonly status: "pending" | "succeeded" | "failed";
  readonly productSlugs: readonly string[];
};

// Step 3 of the refund flow, after Stripe answered (or did not). Returns the refund's status
// now; a lost answer leaves it pending for the sync. `onFailure` runs in the same transaction
// when the request itself failed (the cancel undoes itself there).
async function settle(
  reserved: Reserved,
  answer: StripeAnswer,
  onFailure?: (tx: Tx) => Promise<void>,
): Promise<Settled> {
  if (answer.kind === "unknown") return { status: "pending", productSlugs: [] };
  const report =
    answer.kind === "answered"
      ? answer.report
      : { stripeRefundId: null, status: "failed", failureMessage: answer.message, at: null };
  const requestFailed = answer.kind === "refused" || refundOutcome(report.status) === "failed";

  return db.$transaction(async (tx) => {
    const applied: AppliedOutcome | null = await applyRefundOutcome(
      tx,
      reserved.refundId,
      report,
      "action",
    );
    // The webhook may have settled it first; the row says where it is now either way.
    const row = await tx.refund.findUniqueOrThrow({
      where: { id: reserved.refundId },
      select: { status: true },
    });
    if (requestFailed && row.status === "failed" && onFailure) await onFailure(tx);
    return { status: row.status, productSlugs: applied?.productSlugs ?? [] };
  });
}

function expireAfterRestock(productSlugs: readonly string[]) {
  if (productSlugs.length === 0) return;
  updateTag(catalogTag);
  for (const slug of productSlugs) updateTag(productTag(slug));
}

function answerError(
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

// AC-9 to AC-13: reserve under the order lock, call Stripe with no transaction open, settle.
export async function refundOrder(
  input: unknown,
): Result<{ readonly refundId: string; readonly status: "pending" | "succeeded" }> {
  const admin = await requireAdmin();
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { lines, refundShipping, reason, orderNumber } = parsed.data;

  const reserved = await db.$transaction(async (tx): Promise<Reserved | OrderActionError> => {
    const guarded = await guard(tx, parsed.data, "refund");
    if (isError(guarded)) return guarded;
    const { order, math } = guarded;
    if (order.paymentIntentId === null) return { code: "invalid_transition" };

    const amount = parseMoney(parsed.data.amount, order.currency);
    if (!amount.ok) {
      return { code: "invalid_input", fields: { amount: ["Enter an amount like 12.50."] } };
    }
    const errors = refundRequestErrors(math, {
      lines,
      refundShipping,
      amountCents: amount.cents,
    });
    if (errors) return { code: "invalid_input", fields: errors };

    const refundId = await reserveRefund(tx, {
      order,
      adminId: admin.id,
      amountCents: amount.cents,
      reason,
      includesShipping: refundShipping,
      lines,
    });
    return { order, paymentIntentId: order.paymentIntentId, refundId, amountCents: amount.cents };
  });
  if (isError(reserved)) return refused(admin.id, orderNumber, "refund", reserved);
  logOrderAdminEvent("refund.created", {
    adminId: admin.id,
    orderId: reserved.order.id,
    number: reserved.order.number,
    refundId: reserved.refundId,
    amountCents: reserved.amountCents,
  });

  const answer = await requestStripeRefund({
    refundId: reserved.refundId,
    orderId: reserved.order.id,
    orderNumber: reserved.order.number,
    paymentIntentId: reserved.paymentIntentId,
    amountCents: reserved.amountCents,
  });
  const settled = await settleOrPending(reserved, answer);
  expireAfterRestock(settled.productSlugs);
  revalidatePath(adminOrderPath(reserved.order.number));

  const error = answerError(answer, reserved, settled);
  if (error) return { ok: false, error };
  return {
    ok: true,
    data: {
      refundId: reserved.refundId,
      status: settled.status === "succeeded" ? "succeeded" : "pending",
    },
  };
}

// Stripe may already have the money moving, so a database error here must not hide that: the
// refund stays pending and the sync settles it.
async function settleOrPending(
  reserved: Reserved,
  answer: StripeAnswer,
  onFailure?: (tx: Tx) => Promise<void>,
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
    return { status: "pending", productSlugs: [] };
  }
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

export async function cancelOrder(
  input: unknown,
): Result<{ readonly status: OrderStatus; readonly refundId: string | null }> {
  const admin = await requireAdmin();
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const peek = await db.order.findUnique({
    where: { number: parsed.data.orderNumber },
    select: { status: true },
  });
  if (!peek) return { ok: false, error: { code: "not_found" } };
  return peek.status === "pending_payment"
    ? cancelPending(admin.id, parsed.data)
    : cancelPaid(admin.id, parsed.data);
}

type CancelInput = z.infer<typeof cancelSchema>;

// AC-14: the same transaction reserves the refund for everything left and cancels, so a crash
// during the Stripe call leaves a cancelled order with a pending refund, never a paid order
// whose money is gone. If Stripe refuses, the order goes back to paid.
async function cancelPaid(
  adminId: string,
  input: CancelInput,
): Result<{ readonly status: OrderStatus; readonly refundId: string | null }> {
  const reserved = await db.$transaction(
    async (tx): Promise<(Reserved & { readonly refunds: boolean }) | OrderActionError> => {
      const guarded = await guard(tx, input, "cancel");
      if (isError(guarded)) return guarded;
      const { order, math } = guarded;
      if (order.status !== "paid") return { code: "invalid_transition" };
      const plan = cancelPlan(math, input.restockLineIds);

      let refundId = "";
      if (plan.amountCents > 0) {
        if (order.paymentIntentId === null) return { code: "invalid_transition" };
        refundId = await reserveRefund(tx, {
          order,
          adminId,
          amountCents: plan.amountCents,
          reason: input.reason,
          includesShipping: plan.includesShipping,
          lines: plan.lines,
        });
      }
      const moved = await transitions.markCancelled(tx, {
        orderId: order.id,
        adminId,
        from: "paid",
        reason: input.reason,
      });
      if (!moved) throw new Error(`Order ${order.number} left paid under its row lock`);
      return {
        order,
        paymentIntentId: order.paymentIntentId ?? "",
        refundId,
        amountCents: plan.amountCents,
        refunds: plan.amountCents > 0,
      };
    },
  );
  if (isError(reserved)) return refused(adminId, input.orderNumber, "cancel", reserved);

  if (!reserved.refunds) {
    logCancelled(adminId, reserved.order, null);
    return { ok: true, data: { status: "cancelled", refundId: null } };
  }
  logOrderAdminEvent("refund.created", {
    adminId,
    orderId: reserved.order.id,
    number: reserved.order.number,
    refundId: reserved.refundId,
    amountCents: reserved.amountCents,
  });

  const answer = await requestStripeRefund({
    refundId: reserved.refundId,
    orderId: reserved.order.id,
    orderNumber: reserved.order.number,
    paymentIntentId: reserved.paymentIntentId,
    amountCents: reserved.amountCents,
  });
  let undone = false;
  const settled = await settleOrPending(reserved, answer, async (tx) => {
    undone = await transitions.revertCancelled(tx, { orderId: reserved.order.id, adminId });
  });
  expireAfterRestock(settled.productSlugs);
  revalidatePath(adminOrderPath(reserved.order.number));

  const error = answerError(answer, reserved, settled);
  if (!undone) logCancelled(adminId, reserved.order, reserved.refundId);
  if (error) return { ok: false, error };
  return { ok: true, data: { status: "cancelled", refundId: reserved.refundId } };
}

// AC-15: a pending order is cancelled only once Stripe can no longer take its money.
async function cancelPending(
  adminId: string,
  input: CancelInput,
): Result<{ readonly status: OrderStatus; readonly refundId: string | null }> {
  // A first look without a lock: no lock may be held across the Stripe calls below. The lock
  // and every check run again before the write.
  const first = await db.$transaction((tx) => guard(tx, input, "cancel"));
  if (isError(first)) return refused(adminId, input.orderNumber, "cancel", first);

  const sessionId = first.order.sessionId;
  if (sessionId !== null) {
    const gate = await sessionGate(sessionId);
    if (gate !== "clear") {
      return {
        ok: false,
        error:
          gate === "unreachable"
            ? { code: "stripe_unavailable", refundPending: false }
            : { code: "payment_in_progress" },
      };
    }
  }

  const outcome = await db.$transaction(async (tx) => {
    // Expiring the session makes Stripe send checkout.session.expired, which can expire the
    // order before this runs. That is the outcome the admin asked for (no money can be taken),
    // so it counts as done, with their reason kept as a note, not as a stale page.
    const locked = await lockOrderByNumber(tx, input.orderNumber);
    if (locked?.status === "expired" && first.order.status === "pending_payment") {
      await tx.orderEvent.create({
        data: {
          orderId: locked.id,
          type: "note",
          actorType: "admin",
          adminId,
          message: `Cancelled: ${input.reason}`,
        },
      });
      return { expired: locked };
    }
    const guarded = await guard(tx, input, "cancel");
    if (isError(guarded)) return guarded;
    if (guarded.order.status !== "pending_payment") {
      return { code: "invalid_transition" } as const;
    }
    const moved = await transitions.markCancelled(tx, {
      orderId: guarded.order.id,
      adminId,
      from: "pending_payment",
      reason: input.reason,
    });
    return moved ? guarded.order : ({ code: "invalid_transition" } as const);
  });
  if (isError(outcome)) return refused(adminId, input.orderNumber, "cancel", outcome);
  if ("expired" in outcome) {
    logCancelled(adminId, first.order, null);
    return { ok: true, data: { status: "expired", refundId: null } };
  }

  logCancelled(adminId, outcome, null);
  return { ok: true, data: { status: "cancelled", refundId: null } };
}

// open → expire it; expired → clear; anything that may take money → wait. A failed expire is
// judged by the session's state after it, never by the error.
async function sessionGate(sessionId: string): Promise<"clear" | "busy" | "unreachable"> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return "unreachable";
  }
  const state = sessionState(session);
  if (state === "expired") return "clear";
  if (state !== "open") return "busy";
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return "clear";
  } catch {
    try {
      const again = await stripe.checkout.sessions.retrieve(sessionId);
      return sessionState(again) === "expired" ? "clear" : "busy";
    } catch {
      return "unreachable";
    }
  }
}

function logCancelled(adminId: string, order: LockedOrder, refundId: string | null) {
  logOrderAdminEvent("order.cancelled", {
    adminId,
    orderId: order.id,
    number: order.number,
    from: order.status,
    refundId,
  });
}

// ─── Check with Stripe ───────────────────────────────────────────────────────

// AC-17: the order page's button for a pending refund older than 2 minutes.
export async function checkRefundWithStripe(
  input: unknown,
): Result<{ readonly status: "pending" | "succeeded" | "failed" }> {
  await requireAdmin();
  const parsed = checkRefundSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const refund = await db.refund.findFirst({
    where: { id: parsed.data.refundId, order: { number: parsed.data.orderNumber } },
    select: { status: true, stripeRefundId: true, createdAt: true },
  });
  if (!refund) return { ok: false, error: { code: "not_found" } };
  if (!canCheckWithStripe(refund, Date.now())) {
    return { ok: true, data: { status: refund.status } };
  }

  let result: Awaited<ReturnType<typeof syncRefund>>;
  try {
    result = await syncRefund(parsed.data.refundId, Date.now());
  } catch {
    return { ok: false, error: { code: "stripe_unavailable", refundPending: false } };
  }
  if (!result) return { ok: false, error: { code: "not_found" } };
  expireAfterRestock(result.applied?.productSlugs ?? []);
  revalidatePath(adminOrderPath(parsed.data.orderNumber));
  return { ok: true, data: { status: result.status } };
}
