import { describe, expect, it } from "vitest";

import {
  canSendAgain,
  emailKindLabel,
  emailStatusText,
  failureReason,
  queuedAgainNote,
} from "./email-status";

const dateFormat = { locale: "en", timeZone: "Europe/Warsaw" };
const money = { currency: "EUR", locale: "en" };

// spec 0011, AC-13 and AC-14.
describe("emailKindLabel", () => {
  it("names each kind, with the refund's amount", () => {
    expect(emailKindLabel({ kind: "order_confirmation", refundAmountCents: null }, money)).toBe(
      "Order confirmation",
    );
    expect(emailKindLabel({ kind: "order_shipped", refundAmountCents: null }, money)).toBe(
      "Shipped",
    );
    expect(emailKindLabel({ kind: "order_refunded", refundAmountCents: 1250 }, money)).toBe(
      "Refund €12.50",
    );
  });
});

describe("emailStatusText", () => {
  it("shows when a sent email went out, in the store's time zone", () => {
    expect(
      emailStatusText(
        { status: "sent", errorCode: null, sentAt: new Date("2026-10-13T22:30:00Z") },
        dateFormat,
      ),
    ).toBe("Sent Oct 14, 2026, 12:30 AM");
  });

  it("shows a sent row with an idempotent conflict as just Sent", () => {
    expect(
      emailStatusText(
        { status: "sent", errorCode: "idempotent_conflict", sentAt: new Date() },
        dateFormat,
      ),
    ).toBe("Sent");
  });

  it("shows Sending for a pending row with no error, and the error while it waits", () => {
    expect(emailStatusText({ status: "pending", errorCode: null, sentAt: null }, dateFormat)).toBe(
      "Sending",
    );
    expect(
      emailStatusText(
        { status: "pending", errorCode: "invalid_api_key", sentAt: null },
        dateFormat,
      ),
    ).toBe("Waiting to retry: invalid_api_key");
  });

  it.each([
    ["validation_error", "Failed: The address was refused"],
    ["gave_up", "Failed: Gave up after 23 hours, it may have been sent"],
    ["email_missing", "Failed: No email address on the order"],
    ["invalid_parameter", "Failed: The email service refused it (invalid_parameter)"],
  ])("words a failed row with %s in plain words", (errorCode, text) => {
    expect(emailStatusText({ status: "failed", errorCode, sentAt: null }, dateFormat)).toBe(text);
  });
});

describe("failureReason", () => {
  it("never shows a raw error code by itself", () => {
    expect(failureReason("not_found")).toBe("The email service refused it (not_found)");
  });
});

describe("canSendAgain", () => {
  it("offers Send again on failed rows except a missing address", () => {
    expect(canSendAgain({ status: "failed", errorCode: "gave_up" })).toBe(true);
    expect(canSendAgain({ status: "failed", errorCode: "validation_error" })).toBe(true);
    expect(canSendAgain({ status: "failed", errorCode: "email_missing" })).toBe(false);
    expect(canSendAgain({ status: "pending", errorCode: "rate_limit_exceeded" })).toBe(false);
    expect(canSendAgain({ status: "sent", errorCode: null })).toBe(false);
  });
});

describe("queuedAgainNote", () => {
  it("words the history note", () => {
    expect(queuedAgainNote("order_confirmation")).toBe("Order confirmation email queued again");
    expect(queuedAgainNote("order_refunded")).toBe("Refund email queued again");
  });
});
