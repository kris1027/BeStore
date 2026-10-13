import type { EmailKind } from "@/generated/prisma/client";
import { pgErrorCode } from "@/lib/db-errors";
import { logger } from "@/lib/logger";

// spec 0011, AC-17: the row id, kind, order id and number, refund id, attempts and Resend's
// error name. Never a recipient address, a subject, a body, a name, an address or a tracking
// number. `errorName`, never `code`: the logger redacts any key named code.

export type EmailLogFields = {
  readonly emailSendId: string;
  readonly kind: EmailKind;
  readonly orderId: string;
  readonly orderNumber?: number;
  readonly refundId: string | null;
  readonly attempts?: number;
};

export function logEmailQueued(fields: EmailLogFields) {
  logger.info({ event: "email.queued", ...fields }, "email.queued");
}

export function logEmailSent(fields: EmailLogFields & { readonly transport: "log" | "resend" }) {
  logger.info({ event: "email.sent", ...fields }, "email.sent");
}

export function logEmailRetry(fields: EmailLogFields & { readonly errorName: string }) {
  logger.warn({ event: "email.retry", ...fields }, "email.retry");
}

export function logEmailFailed(fields: EmailLogFields & { readonly errorName: string }) {
  logger.warn({ event: "email.failed", ...fields }, "email.failed");
}

export function logEmailGaveUp(fields: EmailLogFields) {
  logger.error({ event: "email.gave_up", ...fields }, "email.gave_up");
}

export function logEmailIdempotentConflict(fields: EmailLogFields) {
  logger.warn({ event: "email.idempotent_conflict", ...fields }, "email.idempotent_conflict");
}

export function logEmailConfigError(fields: EmailLogFields & { readonly errorName: string }) {
  logger.error({ event: "email.config_error", ...fields }, "email.config_error");
}

export function logEmailResendRequested(fields: EmailLogFields & { readonly adminId: string }) {
  logger.info({ event: "email.resend_requested", ...fields }, "email.resend_requested");
}

// Reused from spec 0008: the order's email was purged before a late email was due (AC-12).
export function logOrderEmailMissing(orderId: string, emailSendId: string) {
  logger.warn({ event: "order.email_missing", orderId, emailSendId }, "order.email_missing");
}

// A delivery that threw (a database error, a template bug). The row stays pending for the sweep.
// The error's name and SQLSTATE only: a Postgres message can quote the row.
export function logEmailDeliveryError(emailSendId: string, error: unknown) {
  logger.error(
    {
      event: "email.retry",
      emailSendId,
      errorName: error instanceof Error ? error.name : typeof error,
      pgCode: pgErrorCode(error),
    },
    "email.retry",
  );
}

export type EmailSweepCounts = {
  readonly gaveUp: number;
  readonly sent: number;
  readonly retry: number;
  readonly failed: number;
  readonly skipped: number;
};

export function logEmailSweep(counts: EmailSweepCounts) {
  logger.info({ event: "cron.email_sweep", ...counts }, "cron.email_sweep");
}
