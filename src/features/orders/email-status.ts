import type { EmailKind, EmailSendStatus } from "@/generated/prisma/enums";
import { type DateFormat, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

// Pure: the words the order page's Emails section shows for an email row (spec 0011, AC-13 and
// AC-14). The page shows these, never a raw error_code by itself.

export type AdminEmailSend = {
  readonly id: string;
  readonly kind: EmailKind;
  readonly status: EmailSendStatus;
  readonly attempts: number;
  readonly errorCode: string | null;
  readonly sentAt: Date | null;
  // The refund's amount, for a refund email.
  readonly refundAmountCents: number | null;
};

export function emailKindLabel(
  email: Pick<AdminEmailSend, "kind" | "refundAmountCents">,
  money: { readonly currency: string; readonly locale: string },
): string {
  switch (email.kind) {
    case "order_confirmation":
      return "Order confirmation";
    case "order_shipped":
      return "Shipped";
    case "order_refunded":
      return email.refundAmountCents === null
        ? "Refund"
        : `Refund ${formatMoney(email.refundAmountCents, money)}`;
  }
}

// The history note Send again writes (AC-14): "Order confirmation email queued again".
export function queuedAgainNote(kind: EmailKind): string {
  const words: Record<EmailKind, string> = {
    order_confirmation: "Order confirmation",
    order_shipped: "Shipped",
    order_refunded: "Refund",
  };
  return `${words[kind]} email queued again`;
}

export function failureReason(errorCode: string | null): string {
  switch (errorCode) {
    case "validation_error":
      return "The address was refused";
    case "gave_up":
      return "Gave up after 23 hours, it may have been sent";
    case "email_missing":
      return "No email address on the order";
    default:
      return `The email service refused it (${errorCode ?? "no reason given"})`;
  }
}

export function emailStatusText(
  email: Pick<AdminEmailSend, "status" | "errorCode" | "sentAt">,
  dateFormat: DateFormat,
): string {
  switch (email.status) {
    case "sent":
      // An idempotent conflict means an earlier try already delivered it; the time we learned
      // that is not the time it was sent.
      return email.sentAt === null || email.errorCode === "idempotent_conflict"
        ? "Sent"
        : `Sent ${formatDateTime(email.sentAt, dateFormat)}`;
    case "pending":
      return email.errorCode === null ? "Sending" : `Waiting to retry: ${email.errorCode}`;
    case "failed":
      return `Failed: ${failureReason(email.errorCode)}`;
  }
}

// AC-14: every failed row but a missing address can be sent again.
export function canSendAgain(email: Pick<AdminEmailSend, "status" | "errorCode">): boolean {
  return email.status === "failed" && email.errorCode !== "email_missing";
}
