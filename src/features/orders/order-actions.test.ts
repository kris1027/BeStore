import { describe, expect, it } from "vitest";

import type { OrderStatus } from "@/generated/prisma/enums";

import {
  type OrderFacts,
  allowedActions,
  canCheckWithStripe,
  CHECK_AFTER_MS,
  IN_FLIGHT_MS,
  isInFlight,
} from "./order-actions";

// spec 0010, AC-8, AC-17, AC-18 and AC-21.

function input(status: OrderStatus, overrides: Partial<OrderFacts> = {}): OrderFacts {
  return {
    status,
    needsAttention: false,
    remainingCents: 1000,
    hasPayment: status !== "pending_payment" && status !== "expired",
    ...overrides,
  };
}

const allowedOf = (value: OrderFacts, refundInFlight = false) =>
  Object.entries(allowedActions(value, refundInFlight))
    .filter(([, allowed]) => allowed)
    .map(([action]) => action);

describe("allowedActions", () => {
  it.each([
    ["pending_payment", ["cancel", "note"]],
    ["paid", ["ship", "refund", "cancel", "note"]],
    ["shipped", ["deliver", "undo", "editTracking", "refund", "note"]],
    ["delivered", ["undo", "editTracking", "refund", "note"]],
    ["cancelled", ["refund", "note"]],
    ["expired", ["note"]],
  ] as const)("on %s allows %j", (status, actions) => {
    expect(allowedOf(input(status))).toEqual(actions);
  });

  it("offers no refund once nothing is left to refund", () => {
    expect(allowedActions(input("delivered", { remainingCents: 0 }), false).refund).toBe(false);
    expect(allowedActions(input("cancelled", { remainingCents: 0 }), false).refund).toBe(false);
  });

  it("offers Mark resolved only on a flagged order", () => {
    expect(allowedActions(input("expired", { needsAttention: true }), false).resolve).toBe(true);
  });

  it("allows only notes while a refund is in flight", () => {
    expect(allowedOf(input("paid", { needsAttention: true }), true)).toEqual(["note"]);
  });

  it("offers a refund on a cancelled or expired order only once it holds a payment", () => {
    // A pending order cancelled before it was paid holds no money.
    expect(allowedOf(input("cancelled", { hasPayment: false }))).toEqual(["note"]);
    // AC-15: a payment that landed after the order expired is refunded from the panel.
    expect(allowedOf(input("expired", { hasPayment: true, needsAttention: true }))).toEqual([
      "refund",
      "resolve",
      "note",
    ]);
  });
});

describe("in flight and Check with Stripe", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms);

  it("is in flight while pending with no Stripe id and younger than 10 minutes", () => {
    const pending = { status: "pending", stripeRefundId: null } as const;
    expect(isInFlight({ ...pending, createdAt: ago(IN_FLIGHT_MS - 1) }, now)).toBe(true);
    expect(isInFlight({ ...pending, createdAt: ago(IN_FLIGHT_MS) }, now)).toBe(false);
    expect(isInFlight({ ...pending, stripeRefundId: "re_1", createdAt: ago(0) }, now)).toBe(false);
    expect(isInFlight({ status: "failed", stripeRefundId: null, createdAt: ago(0) }, now)).toBe(
      false,
    );
  });

  it("offers Check with Stripe on a pending refund older than 2 minutes", () => {
    const pending = { status: "pending", stripeRefundId: "re_1" } as const;
    expect(canCheckWithStripe({ ...pending, createdAt: ago(CHECK_AFTER_MS + 1) }, now)).toBe(true);
    expect(canCheckWithStripe({ ...pending, createdAt: ago(CHECK_AFTER_MS) }, now)).toBe(false);
    expect(
      canCheckWithStripe({ status: "succeeded", stripeRefundId: "re_1", createdAt: ago(1e9) }, now),
    ).toBe(false);
  });
});
