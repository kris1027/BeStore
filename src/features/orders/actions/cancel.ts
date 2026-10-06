"use server";

import type Stripe from "stripe";
import type { z } from "zod";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import type { OrderStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { sessionState } from "@/lib/orders/session-state";
import * as transitions from "@/lib/orders/transitions";
import { stripe } from "@/lib/stripe";

import { logOrderAdminEvent } from "../admin-log";
import type { OrderActionError } from "../messages";
import { type LockedOrder, lockOrderByNumber } from "../order-lock";
import { cancelPlan } from "../refund-math";
import { reserveRefund } from "../refunds";
import { cancelSchema } from "../schemas";
import { guard, invalidInput, isError, refused, type Result } from "./guard";
import {
  answerError,
  expireAfterRefund,
  type Reserved,
  sendToStripe,
  settleOrPending,
} from "./refund-steps";

// spec 0010, AC-14 (a paid order) and AC-15 (an unpaid one). `status` is where the order ended:
// cancelled, or expired when Stripe's expiry event settled a pending order first.
type CancelResult = Result<{ readonly status: OrderStatus; readonly refundId: string | null }>;

type CancelInput = z.infer<typeof cancelSchema>;

export async function cancelOrder(input: unknown): CancelResult {
  const admin = await requireAdmin();
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  // Picks the path only; each path locks the order and checks everything again.
  const current = await db.order.findUnique({
    where: { number: parsed.data.orderNumber },
    select: { status: true },
  });
  if (!current) return { ok: false, error: { code: "not_found" } };
  return current.status === "pending_payment"
    ? cancelPending(admin.id, parsed.data)
    : cancelPaid(admin.id, parsed.data);
}

// AC-14: the same transaction reserves the refund for everything left and cancels, so a crash
// during the Stripe call leaves a cancelled order with a pending refund, never a paid order
// whose money is gone. If Stripe refuses, the order goes back to paid.
async function cancelPaid(adminId: string, input: CancelInput): CancelResult {
  const outcome = await db.$transaction(
    async (
      tx,
    ): Promise<
      { readonly order: LockedOrder; readonly refund: Reserved | null } | OrderActionError
    > => {
      const guarded = await guard(tx, input, "cancel");
      if (isError(guarded)) return guarded;
      const { order, ledger } = guarded;
      if (order.status !== "paid") return { code: "invalid_transition" };
      const plan = cancelPlan(ledger, input.restockLineIds);
      const paymentIntentId = order.paymentIntentId;
      if (plan.amountCents > 0 && paymentIntentId === null) return { code: "invalid_transition" };

      const refund =
        plan.amountCents > 0 && paymentIntentId !== null
          ? {
              order,
              paymentIntentId,
              amountCents: plan.amountCents,
              refundId: await reserveRefund(tx, {
                order,
                adminId,
                amountCents: plan.amountCents,
                reason: input.reason,
                includesShipping: plan.includesShipping,
                lines: plan.lines,
              }),
            }
          : null;
      const moved = await transitions.markCancelled(tx, {
        orderId: order.id,
        adminId,
        from: "paid",
        reason: input.reason,
      });
      if (!moved) throw new Error(`Order ${order.number} left paid under its row lock`);
      return { order, refund };
    },
  );
  if (isError(outcome)) return refused(adminId, input.orderNumber, "cancel", outcome);

  const { refund } = outcome;
  if (refund === null) {
    logCancelled(adminId, outcome.order, null);
    return { ok: true, data: { status: "cancelled", refundId: null } };
  }

  const answer = await sendToStripe(adminId, refund);
  const settled = await settleOrPending(refund, answer, (tx) =>
    transitions.revertCancelled(tx, { orderId: refund.order.id, adminId }),
  );
  expireAfterRefund(refund.order.number, settled.productSlugs);

  const error = answerError(answer, refund, settled);
  if (!settled.undone) logCancelled(adminId, refund.order, refund.refundId);
  if (error) return { ok: false, error };
  return { ok: true, data: { status: "cancelled", refundId: refund.refundId } };
}

// AC-15: a pending order is cancelled only once Stripe can no longer take its money.
async function cancelPending(adminId: string, input: CancelInput): CancelResult {
  // A first look under the lock, committed before the Stripe calls below: no lock may be held
  // across them. The lock and every check run again before the write.
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
    // order before this runs and so moves updated_at. That is the outcome the admin asked for
    // (no money can be taken), so it counts as done, with their reason kept as a note, not as a
    // stale page. The first look already ran the stale check, and a pending order has no
    // refund to be in flight.
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
