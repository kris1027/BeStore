import "server-only";

import type { EmailKind } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";

import { logEmailQueued } from "./log";

// The outbox insert (spec 0011, AC-1 to AC-3): runs in the caller's transaction, so the change
// and the promise to email about it commit (or roll back) together. A raw INSERT ... ON CONFLICT
// DO NOTHING, because a Prisma create would abort the transaction on a duplicate key; a second
// enqueue of the same email (a replayed event, Undo then ship again, a refund that comes back to
// succeeded) is a normal null.

export type EnqueueInput =
  | { readonly orderId: string; readonly kind: "order_confirmation" | "order_shipped" }
  | { readonly orderId: string; readonly kind: "order_refunded"; readonly refundId: string };

// Spec 0002's format, sent unchanged to Resend as the idempotency key.
export function dedupeKey(input: EnqueueInput): string {
  return input.kind === "order_refunded"
    ? `order_refunded:${input.refundId}`
    : `${input.kind}:${input.orderId}`;
}

// Returns the new row's id, or null when this email was already queued. The refund wording is
// frozen here from the order the caller has locked, after this refund was counted: "cancelled
// and refunded" only when the order is cancelled and refunded in full (AC-3).
export async function enqueueEmail(tx: Tx, input: EnqueueInput): Promise<string | null> {
  const refundId = input.kind === "order_refunded" ? input.refundId : null;
  const kind: EmailKind = input.kind;
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO email_sends (order_id, kind, dedupe_key, refund_id, cancelled_wording)
    SELECT o.id, ${kind}::email_kind, ${dedupeKey(input)}, ${refundId}::uuid,
           ${kind}::email_kind = 'order_refunded'
             AND o.status = 'cancelled' AND o.refunded_cents = o.total_cents
    FROM orders o WHERE o.id = ${input.orderId}::uuid
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`;
  if (!row) return null;
  logEmailQueued({ emailSendId: row.id, kind, orderId: input.orderId, refundId });
  return row.id;
}
