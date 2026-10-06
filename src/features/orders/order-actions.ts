// Pure: which admin actions an order allows right now (spec 0010, AC-8, AC-18, AC-21). The page
// offers only these, and every action checks the same rule again under the order row lock.

import type { OrderStatus } from "@/generated/prisma/enums";

export type OrderAction =
  "ship" | "deliver" | "undo" | "editTracking" | "refund" | "cancel" | "resolve" | "note";

export type AllowedActions = Readonly<Record<OrderAction, boolean>>;

// What the status rule reads. The in flight rule (AC-18) is separate: under the order lock the
// actions check it first, with its own message.
export type OrderFacts = {
  readonly status: OrderStatus;
  readonly needsAttention: boolean;
  readonly remainingCents: number;
  // The order holds a Stripe payment to refund: a cancelled or expired order only does after a
  // late payment (AC-15), whose payment intent flagLatePayment saves.
  readonly hasPayment: boolean;
};

// A request to Stripe with no answer yet: younger than this and with no Stripe refund id, it
// may still land, so nothing else may touch the order's money or status (AC-18).
export const IN_FLIGHT_MS = 10 * 60 * 1000;
// "Check with Stripe" appears once a pending refund is older than this (AC-17).
export const CHECK_AFTER_MS = 2 * 60 * 1000;

export function statusAllows(action: OrderAction, input: OrderFacts): boolean {
  switch (action) {
    case "ship":
      return input.status === "paid";
    case "deliver":
      return input.status === "shipped";
    case "undo":
    case "editTracking":
      return input.status === "shipped" || input.status === "delivered";
    case "refund":
      return (
        (input.status === "paid" ||
          input.status === "shipped" ||
          input.status === "delivered" ||
          input.status === "cancelled" ||
          input.status === "expired") &&
        input.hasPayment &&
        input.remainingCents > 0
      );
    case "cancel":
      return input.status === "paid" || input.status === "pending_payment";
    case "resolve":
      return input.needsAttention;
    case "note":
      return true;
  }
}

export function allowedActions(input: OrderFacts, refundInFlight: boolean): AllowedActions {
  const allows = (action: OrderAction) =>
    statusAllows(action, input) && (action === "note" || !refundInFlight);
  return {
    ship: allows("ship"),
    deliver: allows("deliver"),
    undo: allows("undo"),
    editTracking: allows("editTracking"),
    refund: allows("refund"),
    cancel: allows("cancel"),
    resolve: allows("resolve"),
    note: allows("note"),
  };
}

export type PendingRefund = {
  readonly status: "pending" | "succeeded" | "failed";
  readonly stripeRefundId: string | null;
  readonly createdAt: Date;
};

export function isInFlight(refund: PendingRefund, nowMs: number): boolean {
  return (
    refund.status === "pending" &&
    refund.stripeRefundId === null &&
    nowMs - refund.createdAt.getTime() < IN_FLIGHT_MS
  );
}

export function canCheckWithStripe(refund: PendingRefund, nowMs: number): boolean {
  return refund.status === "pending" && nowMs - refund.createdAt.getTime() > CHECK_AFTER_MS;
}
