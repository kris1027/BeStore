import "server-only";

import type { Tx } from "@/lib/db";
import { countRedemptions, lockCode } from "@/lib/discounts/codes";
import {
  type DiscountRefused,
  type DiscountType,
  evaluateDiscount,
  refusedDiscount,
} from "@/lib/discounts/rule";
import { parseCodeText } from "@/lib/discounts/schema";
import { env } from "@/lib/env";
import type { ActionResult } from "@/lib/result";
import type { ShippingSettings } from "@/lib/shipping/rule";
import { stripe } from "@/lib/stripe";

import { logCouponFailed, logDiscountRefused, stripeErrorCode } from "./log";

// What a promo code adds to Pay (spec 0014), kept apart from freezing the cart so startCheckout
// changes for one reason at a time. The rule itself lives in src/lib/discounts/.

export type AppliedCode = {
  readonly codeId: string;
  readonly code: string;
  readonly type: DiscountType;
  readonly value: number;
  readonly discountCents: number;
};

// spec 0014, AC-3 to AC-5: inside the order transaction, after the customer and cart locks. The
// code row lock serializes every checkout using this code, so two racing for its last use (or
// the last use for one email) end with one redemption. Pay counts every use: the cart's own
// earlier pending order was already expired by clearPendingOrder. null: no code was sent.
export async function applyLockedCode(
  tx: Tx,
  input: {
    readonly codeInput: unknown;
    readonly email: string;
    readonly subtotalCents: number;
    readonly settings: ShippingSettings;
    readonly minimumCents: number;
  },
): Promise<ActionResult<AppliedCode | null, DiscountRefused>> {
  if (!wantsCode(input.codeInput)) return { ok: true, data: null };
  const text = parseCodeText(input.codeInput);
  const code = text === null ? null : await lockCode(tx, { code: text });
  const counts =
    code === null
      ? { uses: 0, customerUses: 0 }
      : await countRedemptions(tx, code.id, { email: input.email });
  const evaluation = evaluateDiscount({
    code,
    subtotalCents: input.subtotalCents,
    settings: input.settings,
    minimumCents: input.minimumCents,
    now: code?.now ?? new Date(),
    uses: counts.uses,
    customerUses: counts.customerUses ?? 0,
  });
  if (!evaluation.ok) {
    logDiscountRefused({
      stage: "pay",
      reason: evaluation.reason,
      discountCodeId: code?.id ?? null,
    });
    return { ok: false, error: refusedDiscount(evaluation) };
  }
  // A refusal above covers a missing code; reaching here means the row exists.
  if (code === null) throw new Error("A discount applied without a code row");
  return {
    ok: true,
    data: {
      codeId: code.id,
      code: code.code,
      type: code.type,
      value: code.value,
      discountCents: evaluation.discountCents,
    },
  };
}

// An absent or empty field means no code; anything else is checked, and refused if it is not one.
function wantsCode(codeInput: unknown): boolean {
  return !(codeInput === undefined || codeInput === null || codeInput === "");
}

// spec 0014, AC-7: after the order commits and before the session, a single use coupon with
// the order's exact discount, so Stripe's amount_total equals our total. Its fixed id and
// idempotency key make a retry land on the same coupon. Answers the coupon id, or null when it
// could not be created (the caller then expires the order, which frees its use, AC-8).
export async function createOrderCoupon(order: {
  readonly id: string;
  readonly code: string;
  readonly discountCents: number;
}): Promise<string | null> {
  const id = `order_${order.id}`;
  try {
    await stripe.coupons.create(
      {
        id,
        amount_off: order.discountCents,
        currency: env.STORE_CURRENCY.toLowerCase(),
        duration: "once",
        max_redemptions: 1,
        name: order.code,
        metadata: { order_id: order.id },
      },
      { idempotencyKey: `coupon:${order.id}` },
    );
  } catch (error) {
    // A create that already happened (a retried request) left the same coupon behind.
    if (stripeErrorCode(error) === "resource_already_exists") return id;
    logCouponFailed(order.id, error);
    return null;
  }
  return id;
}
