import { describe, expect, it } from "vitest";

import { type SessionFields, sessionState } from "./session-state";

// spec 0006, AC-4, AC-6, AC-9, AC-11, AC-15: every status and payment status pair Stripe sends.

describe("sessionState", () => {
  it.each<[SessionFields["status"], SessionFields["payment_status"], string]>([
    ["open", "unpaid", "open"],
    ["open", "paid", "open"],
    ["open", "no_payment_required", "open"],
    ["complete", "paid", "paid"],
    ["complete", "no_payment_required", "paid"],
    ["complete", "unpaid", "processing"],
    ["expired", "unpaid", "expired"],
    ["expired", "paid", "expired"],
    ["expired", "no_payment_required", "expired"],
  ])("reads %s with %s as %s", (status, paymentStatus, state) => {
    expect(sessionState({ status, payment_status: paymentStatus })).toBe(state);
  });

  it("is unknown for a complete session with a payment status it does not know", () => {
    expect(sessionState({ status: "complete", payment_status: "refunded" })).toBe("unknown");
  });

  it.each([null, "archived"])("is unknown for status %s", (status) => {
    expect(sessionState({ status, payment_status: "paid" })).toBe("unknown");
  });
});
