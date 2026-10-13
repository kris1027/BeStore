"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import type { EmailKind, EmailSendStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { logEmailResendRequested } from "@/lib/email/log";
import { scheduleDelivery } from "@/lib/email/schedule";

import { canSendAgain, queuedAgainNote } from "../email-status";
import type { OrderActionError } from "../messages";
import { lockOrderByNumber } from "../order-lock";
import { adminOrderPath } from "../paths";
import { sendEmailAgainSchema } from "../schemas";
import { invalidInput, isError, type Result } from "./guard";

type EmailRow = {
  id: string;
  kind: EmailKind;
  status: EmailSendStatus;
  error_code: string | null;
  refund_id: string | null;
  attempts: number;
};

// spec 0011, AC-14 and AC-15: a failed email goes back to pending with a fresh 23 hour window,
// then is sent after the response like any queued email. Resend's idempotency key still makes a
// copy delivered in the last 24 hours go out once. Works in any order status, and leaves the
// order's attention flag for "Mark resolved".
export async function sendEmailAgain(input: unknown): Result<{ readonly status: "pending" }> {
  const admin = await requireAdmin();
  const parsed = sendEmailAgainSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { orderNumber, emailSendId } = parsed.data;

  const outcome = await db.$transaction(
    async (
      tx,
    ): Promise<{ readonly orderId: string; readonly row: EmailRow } | OrderActionError> => {
      // The order first, then the email row (spec 0010's lock order).
      const order = await lockOrderByNumber(tx, orderNumber);
      if (!order) return { code: "not_found" };
      const [row] = await tx.$queryRaw<EmailRow[]>`
        SELECT id, kind, status, error_code, refund_id, attempts FROM email_sends
        WHERE id = ${emailSendId}::uuid AND order_id = ${order.id}::uuid
        FOR UPDATE`;
      if (!row) return { code: "not_found" };
      if (!canSendAgain({ status: row.status, errorCode: row.error_code })) {
        return { code: "email_changed" };
      }
      await tx.$executeRaw`
        UPDATE email_sends
        SET status = 'pending', queued_at = now(), last_attempt_at = NULL, error_code = NULL,
            updated_at = now()
        WHERE id = ${row.id}::uuid AND status = 'failed'`;
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "note",
          actorType: "admin",
          adminId: admin.id,
          message: queuedAgainNote(row.kind),
        },
      });
      return { orderId: order.id, row };
    },
  );
  if (isError(outcome)) return { ok: false, error: outcome };

  scheduleDelivery([outcome.row.id]);
  logEmailResendRequested({
    adminId: admin.id,
    emailSendId: outcome.row.id,
    kind: outcome.row.kind,
    orderId: outcome.orderId,
    orderNumber,
    refundId: outcome.row.refund_id,
    attempts: outcome.row.attempts,
  });
  revalidatePath(adminOrderPath(orderNumber));
  return { ok: true, data: { status: "pending" } };
}
