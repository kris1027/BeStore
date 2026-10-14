import "server-only";

import type { EmailKind } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { flagOrder, lockOrderById } from "@/lib/orders/lock";

import { classifySendFailure, stopsSweep } from "./classify";
import { loadEmailContent } from "./content";
import { emailKindNames } from "./kinds";
import {
  type EmailLogFields,
  logEmailConfigError,
  logEmailDeliveryError,
  logEmailFailed,
  logEmailIdempotentConflict,
  logEmailRetry,
  logEmailSent,
  logOrderEmailMissing,
} from "./log";
import { renderEmail } from "./render";
import { currentTransport, type Transport } from "./transport";

// One try at one email row (spec 0011, AC-8 to AC-12). There is no lease: every move out of
// pending is guarded by `status = 'pending'`, and zero rows means another worker settled it
// first. Two workers sending one row at once is harmless, because the shared dedupe_key makes
// Resend deliver once. Never runs inside a transaction that changes an order.

export type DeliverOutcome = "sent" | "retry" | "failed" | "skipped";

export type DeliverResult = {
  readonly outcome: DeliverOutcome;
  // A config error or a rate limit: the sweep tries no more rows this run (AC-11).
  readonly stopSweep: boolean;
};

// The in process tries (AC-8): right away, then once more after 5 seconds.
export const EMAIL_RETRY_WAITS_MS: readonly number[] = [0, 5_000];

type ClaimedRow = {
  id: string;
  order_id: string;
  kind: EmailKind;
  dedupe_key: string;
  refund_id: string | null;
  cancelled_wording: boolean;
  attempts: number;
};

export function failureNote(kind: EmailKind): string {
  return `The ${emailKindNames[kind].word} email could not be sent. Use Send again on the order page.`;
}

export function missingEmailNote(kind: EmailKind): string {
  return `The ${emailKindNames[kind].word} email was not sent: the order has no email address.`;
}

const done = (outcome: DeliverOutcome, stopSweep = false): DeliverResult => ({
  outcome,
  stopSweep,
});

export async function deliver(
  id: string,
  transport: Transport = currentTransport(),
): Promise<DeliverResult> {
  // Goes on only while the row is pending; the try counts and last_attempt_at tells the sweep a
  // worker is on it.
  const [row] = await db.$queryRaw<ClaimedRow[]>`
    UPDATE email_sends
    SET attempts = attempts + 1, last_attempt_at = now(), updated_at = now()
    WHERE id = ${id}::uuid AND status = 'pending'
    RETURNING id, order_id, kind, dedupe_key, refund_id, cancelled_wording, attempts`;
  if (!row) return done("skipped");

  const order = await db.order.findUnique({
    where: { id: row.order_id },
    select: { number: true, email: true },
  });
  if (!order) return done("skipped");
  const fields: EmailLogFields = {
    emailSendId: row.id,
    kind: row.kind,
    orderId: row.order_id,
    orderNumber: order.number,
    refundId: row.refund_id,
    attempts: row.attempts,
  };

  // A throw from here on (a database error, a template bug) leaves the row pending for the
  // sweep, logged with the row's fields. One before this point is logged by the caller.
  try {
    return await sendClaimed(row, order.email, fields, transport);
  } catch (error) {
    logEmailDeliveryError(fields, error);
    return done("retry");
  }
}

async function sendClaimed(
  row: ClaimedRow,
  email: string | null,
  fields: EmailLogFields,
  transport: Transport,
): Promise<DeliverResult> {
  // AC-12: checked before any content is loaded.
  if (email === null) {
    const moved = await failRow(row, "email_missing", { flag: false });
    if (moved) logOrderEmailMissing(fields);
    return done(moved ? "failed" : "skipped");
  }

  const content = await loadEmailContent({
    orderId: row.order_id,
    kind: row.kind,
    refundId: row.refund_id,
    cancelledWording: row.cancelled_wording,
  });
  const rendered = await renderEmail(content);
  const result = await transport.send({
    to: email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: row.dedupe_key,
  });

  if (result.ok) {
    const moved = await settleSent(row.id, result.resendId, null);
    if (moved) logEmailSent({ ...fields, transport: transport.name });
    return done(moved ? "sent" : "skipped");
  }

  const verdict = classifySendFailure(result.failure);
  switch (verdict.kind) {
    case "already_sent": {
      // The first send carried older content; the customer keeps that one.
      const moved = await settleSent(row.id, null, "idempotent_conflict");
      if (moved) logEmailIdempotentConflict(fields);
      return done(moved ? "sent" : "skipped");
    }
    case "final": {
      const moved = await failRow(row, verdict.errorCode, { flag: true });
      if (moved) logEmailFailed({ ...fields, errorName: verdict.errorCode });
      return done(moved ? "failed" : "skipped");
    }
    case "config":
    case "rate_limited":
    case "retry": {
      await db.$executeRaw`
        UPDATE email_sends SET error_code = ${verdict.errorCode}, updated_at = now()
        WHERE id = ${row.id}::uuid AND status = 'pending'`;
      if (verdict.kind === "config")
        logEmailConfigError({ ...fields, errorName: verdict.errorCode });
      else logEmailRetry({ ...fields, errorName: verdict.errorCode });
      return done("retry", stopsSweep(verdict));
    }
  }
}

async function settleSent(
  id: string,
  resendId: string | null,
  errorCode: "idempotent_conflict" | null,
): Promise<boolean> {
  const moved = await db.$executeRaw`
    UPDATE email_sends
    SET status = 'sent', resend_id = ${resendId}, sent_at = now(), error_code = ${errorCode},
        updated_at = now()
    WHERE id = ${id}::uuid AND status = 'pending'`;
  return moved > 0;
}

// pending to failed, under the order lock (spec 0010's order: order, then refund, then email
// row). Only the worker whose guarded update moved the row writes the note, so it is written
// once per row; the flag is set only when it is not already on (AC-11).
export async function failRow(
  row: { readonly id: string; readonly order_id: string; readonly kind: EmailKind },
  errorCode: string,
  options: { readonly flag: boolean },
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await lockOrderById(tx, row.order_id);
    const moved = await tx.$executeRaw`
      UPDATE email_sends SET status = 'failed', error_code = ${errorCode}, updated_at = now()
      WHERE id = ${row.id}::uuid AND status = 'pending'`;
    if (moved === 0) return false;
    if (options.flag) await flagOrder(tx, row.order_id);
    await tx.orderEvent.create({
      data: {
        orderId: row.order_id,
        type: "note",
        actorType: "system",
        message: options.flag ? failureNote(row.kind) : missingEmailNote(row.kind),
      },
    });
    return true;
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// AC-8: what scheduleDelivery runs after the response. A row still pending after both tries
// waits for the daily sweep. A thrown error is logged and leaves the row pending too.
export async function deliverWithRetry(
  id: string,
  options: { readonly waits?: readonly number[]; readonly transport?: Transport } = {},
): Promise<DeliverOutcome> {
  for (const wait of options.waits ?? EMAIL_RETRY_WAITS_MS) {
    if (wait > 0) await sleep(wait);
    const outcome = await deliver(id, options.transport).then(
      (result) => result.outcome,
      (error: unknown) => {
        logEmailDeliveryError({ emailSendId: id }, error);
        return "retry" as const;
      },
    );
    if (outcome !== "retry") return outcome;
  }
  return "retry";
}

export async function deliverAll(ids: readonly string[]): Promise<void> {
  await Promise.all(ids.map((id) => deliverWithRetry(id)));
}
