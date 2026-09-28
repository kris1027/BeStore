import { describe, expect, it } from "vitest";

import { decideEvent, isHandledEventType } from "./event-decision";

// spec 0006, AC-4 and AC-6.

describe("decideEvent", () => {
  it.each(["paid", "no_payment_required"])("pays on completed with %s", (status) => {
    expect(decideEvent("checkout.session.completed", status)).toEqual({ kind: "pay" });
  });

  it("waits on completed but unpaid (a delayed method)", () => {
    expect(decideEvent("checkout.session.completed", "unpaid")).toEqual({ kind: "processing" });
  });

  it("pays on async_payment_succeeded", () => {
    expect(decideEvent("checkout.session.async_payment_succeeded", "paid")).toEqual({
      kind: "pay",
    });
  });

  it("expires on async_payment_failed and on expired, each with its reason", () => {
    expect(decideEvent("checkout.session.async_payment_failed", "unpaid")).toEqual({
      kind: "expire",
      reason: "Payment failed",
    });
    expect(decideEvent("checkout.session.expired", "unpaid")).toEqual({
      kind: "expire",
      reason: "Checkout session expired",
    });
  });
});

describe("isHandledEventType", () => {
  it("knows the four checkout session events and nothing else", () => {
    expect(isHandledEventType("checkout.session.expired")).toBe(true);
    expect(isHandledEventType("payment_intent.succeeded")).toBe(false);
    expect(isHandledEventType("checkout.session.created")).toBe(false);
  });
});
