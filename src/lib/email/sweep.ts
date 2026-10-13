import "server-only";

import type { EmailKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";

import { deliver, failRow } from "./deliver";
import { type EmailSweepCounts, logEmailDeliveryError, logEmailGaveUp, logEmailSweep } from "./log";
import type { Transport } from "./transport";

// spec 0011, AC-11: the first step of the daily reconcile run. Gives up on rows queued 23 hours
// ago (inside Resend's 24 hour idempotency window, so a later send can only come from an admin's
// Send again), then tries each other owed row once, oldest first, inside its own slice of the
// run's budget.

export const EMAIL_GIVE_UP_MS = 23 * 60 * 60 * 1000;
export const EMAIL_SWEEP_BATCH = 50;
export const EMAIL_SWEEP_BUDGET_MS = 10_000;
// A row queued or tried this recently may still have its own after() running.
export const EMAIL_QUIET_MS = 2 * 60 * 1000;

type DueRow = { id: string; order_id: string; kind: EmailKind; refund_id: string | null };

export async function sweepEmails(
  deadlineMs: number,
  options: { readonly nowMs?: number; readonly transport?: Transport } = {},
): Promise<EmailSweepCounts> {
  const nowMs = options.nowMs ?? Date.now();
  const sliceEndMs = Math.min(deadlineMs, Date.now() + EMAIL_SWEEP_BUDGET_MS);
  const counts = { gaveUp: 0, sent: 0, retry: 0, failed: 0, skipped: 0 };

  const expired = await db.$queryRaw<DueRow[]>`
    SELECT id, order_id, kind, refund_id FROM email_sends
    WHERE status = 'pending' AND queued_at <= ${new Date(nowMs - EMAIL_GIVE_UP_MS)}
    ORDER BY queued_at, id`;
  for (const row of expired) {
    try {
      if (await failRow(row, "gave_up", { flag: true })) {
        counts.gaveUp += 1;
        logEmailGaveUp({
          emailSendId: row.id,
          kind: row.kind,
          orderId: row.order_id,
          refundId: row.refund_id,
        });
      }
    } catch (error) {
      logEmailDeliveryError(row.id, error);
      counts.skipped += 1;
    }
  }

  const quietBefore = new Date(nowMs - EMAIL_QUIET_MS);
  const due = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM email_sends
    WHERE status = 'pending' AND queued_at < ${quietBefore}
      AND (last_attempt_at IS NULL OR last_attempt_at < ${quietBefore})
    ORDER BY queued_at, id
    LIMIT ${EMAIL_SWEEP_BATCH}`;
  for (const { id } of due) {
    // Rows not reached wait for the next run.
    if (Date.now() > sliceEndMs) break;
    try {
      const result = await deliver(id, options.transport);
      counts[result.outcome] += 1;
      if (result.stopSweep) break;
    } catch (error) {
      logEmailDeliveryError(id, error);
      counts.skipped += 1;
    }
  }

  logEmailSweep(counts);
  return counts;
}
