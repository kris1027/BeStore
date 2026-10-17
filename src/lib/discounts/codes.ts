import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { loadCartById } from "@/lib/cart/load-cart";
import { db, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { minimumChargeCents } from "@/lib/orders/minimum-charge";
import { orderCharges } from "@/lib/shipping/rule";
import { readShippingSettings } from "@/lib/shipping/settings";

import {
  type DiscountCodeRules,
  type DiscountRefused,
  type DiscountType,
  evaluateDiscount,
  refusedDiscount,
} from "./rule";
import { normalizeEmail, parseCodeText } from "./schema";

// The database side of a promo code (spec 0014, AC-3 to AC-5 and AC-9): find it, lock it, count
// its uses and record one. Shared by checkout and the admin, so it lives outside both features.

type Client = Tx | typeof db;

export type CodeRow = DiscountCodeRules & {
  readonly id: string;
  readonly code: string;
  // The database clock when the row was read, so every date check uses one clock (AC-3).
  readonly now: Date;
};

type RawCode = {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  max_redemptions: number | null;
  per_customer_limit: number | null;
  min_subtotal_cents: number | null;
  db_now: Date;
};

function toRow(raw: RawCode): CodeRow {
  return {
    id: raw.id,
    code: raw.code,
    type: raw.type,
    value: raw.value,
    active: raw.active,
    startsAt: raw.starts_at,
    endsAt: raw.ends_at,
    maxRedemptions: raw.max_redemptions,
    perCustomerLimit: raw.per_customer_limit,
    minSubtotalCents: raw.min_subtotal_cents,
    now: raw.db_now,
  };
}

// By its text, already uppercased (parseCodeText). No lock: Apply and the prefill only preview.
export async function findCode(client: Client, text: string): Promise<CodeRow | null> {
  const [raw] = await client.$queryRaw<RawCode[]>`
    SELECT id, code, type::text AS type, value, active, starts_at, ends_at, max_redemptions,
           per_customer_limit, min_subtotal_cents, now() AS db_now
    FROM discount_codes WHERE code = ${text}`;
  return raw === undefined ? null : toRow(raw);
}

// Key invariants: taken after the customer and cart locks and before any insert that touches
// the code row's foreign keys. Every writer of a code row takes it first.
export async function lockCode(tx: Tx, where: { readonly id: string } | { readonly code: string }) {
  const [raw] =
    "id" in where
      ? await tx.$queryRaw<RawCode[]>`
          SELECT id, code, type::text AS type, value, active, starts_at, ends_at, max_redemptions,
                 per_customer_limit, min_subtotal_cents, now() AS db_now
          FROM discount_codes WHERE id = ${where.id}::uuid FOR UPDATE`
      : await tx.$queryRaw<RawCode[]>`
          SELECT id, code, type::text AS type, value, active, starts_at, ends_at, max_redemptions,
                 per_customer_limit, min_subtotal_cents, now() AS db_now
          FROM discount_codes WHERE code = ${where.code} FOR UPDATE`;
  return raw === undefined ? null : toRow(raw);
}

// AC-3: how long a pending order holds a use. The session lives at most 31 minutes.
export const PENDING_HOLD_MINUTES = 35;

// AC-3 and AC-10: the one rule for a use, over an order aliased `o`. A redemption counts while
// its order has ever been paid, or is pending and younger than the hold, by the database clock.
export const orderHoldsUse = Prisma.sql`(o.paid_at IS NOT NULL
  OR (o.status = 'pending_payment'
    AND o.created_at > now() - make_interval(mins => ${PENDING_HOLD_MINUTES})))`;

export type RedemptionCounts = {
  readonly uses: number;
  // null when no email was given.
  readonly customerUses: number | null;
};

// `exceptCartId` leaves out this cart's own pending order (Apply and the prefill only: Pay
// replaces that order before it takes the lock).
export async function countRedemptions(
  client: Client,
  codeId: string,
  options: { readonly email?: string | null; readonly exceptCartId?: string | null } = {},
): Promise<RedemptionCounts> {
  const email = options.email == null ? null : normalizeEmail(options.email);
  const exceptCartId = options.exceptCartId ?? null;
  const [row] = await client.$queryRaw<{ uses: bigint; customer_uses: bigint }[]>`
    SELECT count(*) AS uses,
           count(*) FILTER (WHERE r.email = ${email}) AS customer_uses
    FROM discount_redemptions r
    JOIN orders o ON o.id = r.order_id
    WHERE r.discount_code_id = ${codeId}::uuid
      AND ${orderHoldsUse}
      AND (${exceptCartId}::uuid IS NULL OR o.status <> 'pending_payment'
        OR o.cart_id IS DISTINCT FROM ${exceptCartId}::uuid)`;
  return {
    uses: Number(row?.uses ?? 0),
    customerUses: email === null ? null : Number(row?.customer_uses ?? 0),
  };
}

// AC-4: one use, in the order's own transaction, under the code lock.
export async function redeem(
  tx: Tx,
  redemption: { readonly codeId: string; readonly orderId: string; readonly email: string },
): Promise<void> {
  await tx.discountRedemption.create({
    data: {
      discountCodeId: redemption.codeId,
      orderId: redemption.orderId,
      email: normalizeEmail(redemption.email),
    },
    select: { id: true },
  });
}

export type DiscountPreview =
  | { readonly kind: "no_cart" }
  | { readonly kind: "below_minimum"; readonly minimumCents: number }
  | {
      readonly kind: "applied";
      readonly codeId: string;
      readonly code: string;
      readonly discountCents: number;
      readonly shippingCents: number;
      readonly totalCents: number;
    }
  | ({
      readonly kind: "refused";
      // Null when no such code exists: its typed text is never logged (AC-18).
      readonly codeId: string | null;
      readonly code: string | null;
    } & DiscountRefused);

// AC-1, AC-3 and AC-9: what the summary shows for a code, read live (no lock; Pay rechecks under
// one). One function for Apply and the prefill, so the page and the button never disagree.
// `email` is the account email or a valid typed one; null skips the per customer check.
export async function previewDiscount(input: {
  readonly cartId: string;
  readonly codeText: unknown;
  readonly email: string | null;
}): Promise<DiscountPreview> {
  const cart = await loadCartById(input.cartId, new Date());
  if (cart === null || !cart.canCheckout) {
    return { kind: "no_cart" };
  }
  const settings = await readShippingSettings();
  const minimumCents = minimumChargeCents(env.STORE_CURRENCY);
  const subtotalCents = cart.subtotalCents;
  // AC-2: a cart already below the minimum without a code says so before any code check.
  if (orderCharges({ subtotalCents, discountCents: 0 }, settings).totalCents < minimumCents) {
    return { kind: "below_minimum", minimumCents };
  }

  const text = parseCodeText(input.codeText);
  const code = text === null ? null : await findCode(db, text);
  if (code === null) return { kind: "refused", codeId: null, code: null, reason: "invalid" };

  const counts = await countRedemptions(db, code.id, {
    email: input.email,
    exceptCartId: input.cartId,
  });
  const evaluation = evaluateDiscount({
    code,
    subtotalCents,
    settings,
    minimumCents,
    now: code.now,
    uses: counts.uses,
    customerUses: counts.customerUses,
  });
  if (!evaluation.ok) {
    return {
      kind: "refused",
      codeId: code.id,
      code: code.code,
      ...refusedDiscount(evaluation),
    };
  }
  const charges = orderCharges(
    { subtotalCents, discountCents: evaluation.discountCents },
    settings,
  );
  return {
    kind: "applied",
    codeId: code.id,
    code: code.code,
    discountCents: evaluation.discountCents,
    ...charges,
  };
}
