import "server-only";

import type { z } from "zod";

import type { Tx } from "@/lib/db";
import type { ActionResult } from "@/lib/result";

import { logOrderAdminEvent } from "../admin-log";
import type { OrderActionError } from "../messages";
import { type OrderAction, statusAllows } from "../order-actions";
import {
  hasRefundInFlight,
  isStale,
  loadRefundLedger,
  type LockedOrder,
  lockOrderByNumber,
} from "../order-lock";
import { type RefundLedger, remainingCents } from "../refund-math";
import { pathErrors } from "../schemas";

// What every admin order action shares (spec 0010, API surface). Each action calls
// requireAdmin() itself, parses its input with Zod, then locks the order row and checks, in this
// order (AC-8): the form is not stale, no refund is in flight (AC-18), and the status allows the
// action. Amounts always come from the order's rows; the client's amount is only checked against
// them.

export type Result<T> = Promise<ActionResult<T, OrderActionError>>;

export type Guarded = { readonly order: LockedOrder; readonly ledger: RefundLedger };

export function invalidInput(error: z.ZodError): { ok: false; error: OrderActionError } {
  return { ok: false, error: { code: "invalid_input", fields: pathErrors(error) } };
}

export function isError(value: object): value is OrderActionError {
  return "code" in value;
}

// Locks the order and runs the AC-8 checks.
export async function guard(
  tx: Tx,
  input: { readonly orderNumber: number; readonly expectedUpdatedAt: string },
  action: OrderAction,
): Promise<Guarded | OrderActionError> {
  const order = await lockOrderByNumber(tx, input.orderNumber);
  if (!order) return { code: "not_found" };
  if (isStale(order, input.expectedUpdatedAt)) return { code: "stale" };
  if (await hasRefundInFlight(tx, order.id, Date.now())) return { code: "refund_in_progress" };
  const ledger = await loadRefundLedger(tx, order);
  const allowed = statusAllows(action, {
    status: order.status,
    needsAttention: order.needsAttention,
    remainingCents: remainingCents(ledger),
    hasPayment: order.paymentIntentId !== null,
  });
  return allowed ? { order, ledger } : { code: "invalid_transition" };
}

// A stale or moved order is logged as order.action_stale (the order number and action only).
export function refused<T>(
  adminId: string,
  orderNumber: number,
  action: OrderAction,
  error: OrderActionError,
): ActionResult<T, OrderActionError> {
  if (error.code === "stale" || error.code === "invalid_transition") {
    logOrderAdminEvent("order.action_stale", {
      adminId,
      number: orderNumber,
      action,
      reason: error.code,
    });
  }
  return { ok: false, error };
}
