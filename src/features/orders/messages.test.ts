import { describe, expect, it } from "vitest";

import { errorMessage, type OrderActionError } from "./messages";

// spec 0010, API surface: the fixed words an admin sees for each refused action (AC-8, AC-12,
// AC-15, AC-17, AC-18).

describe("errorMessage", () => {
  it.each([
    [{ code: "not_found" }, "This order changed. Reload to see the latest."],
    [{ code: "stale" }, "This order changed. Reload to see the latest."],
    [{ code: "invalid_transition" }, "This order changed. Reload to see the latest."],
    [{ code: "refund_in_progress" }, "A refund is in progress for this order."],
    [
      { code: "payment_in_progress" },
      "A payment is in progress for this order. Wait for it to settle.",
    ],
    [
      { code: "stripe_refused", message: "Charge already refunded" },
      "Stripe refused the refund: Charge already refunded",
    ],
    [
      { code: "stripe_unavailable", refundPending: true },
      "Stripe did not answer. The refund is being checked.",
    ],
    [{ code: "stripe_unavailable", refundPending: false }, "Stripe did not answer. Try again."],
  ] satisfies [OrderActionError, string][])("reads %j as %j", (error, message) => {
    expect(errorMessage(error)).toBe(message);
  });

  it("shows the first root error of invalid input, else points at the fields", () => {
    expect(
      errorMessage({ code: "invalid_input", fields: { root: ["Nothing changed.", "other"] } }),
    ).toBe("Nothing changed.");
    expect(errorMessage({ code: "invalid_input", fields: { amount: ["Too much."] } })).toBe(
      "Check the highlighted fields.",
    );
  });
});
