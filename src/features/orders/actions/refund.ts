"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import { parseMoney } from "@/lib/money";

import type { OrderActionError } from "../messages";
import { canCheckWithStripe } from "../order-actions";
import { refundRequestErrors } from "../refund-math";
import { syncRefund } from "../refund-sync";
import { reserveRefund } from "../refunds";
import { checkRefundSchema, refundSchema } from "../schemas";
import { guard, invalidInput, isError, refused, type Result } from "./guard";
import {
  answerError,
  expireAfterRefund,
  type Reserved,
  sendToStripe,
  settleOrPending,
} from "./refund-steps";

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
    const { order, ledger } = guarded;
    if (order.paymentIntentId === null) return { code: "invalid_transition" };

    const amount = parseMoney(parsed.data.amount, order.currency);
    if (!amount.ok) {
      return { code: "invalid_input", fields: { amount: ["Enter an amount like 12.50."] } };
    }
    const errors = refundRequestErrors(ledger, {
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

  const answer = await sendToStripe(admin.id, reserved);
  const settled = await settleOrPending(reserved, answer);
  expireAfterRefund(reserved.order.number, settled.productSlugs);

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
  expireAfterRefund(parsed.data.orderNumber, result.applied?.productSlugs ?? []);
  return { ok: true, data: { status: result.status } };
}
