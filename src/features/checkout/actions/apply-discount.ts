"use server";

import { z } from "zod";

import { readOwnedCartId } from "@/lib/cart/owned";
import { getCustomer } from "@/lib/customer/session";
import { db } from "@/lib/db";
import { previewDiscount } from "@/lib/discounts/codes";
import type { DiscountRefusal } from "@/lib/discounts/rule";
import type { ActionResult } from "@/lib/result";

import { logDiscountRefused } from "../log";
import { emailSchema } from "../schemas";

export type AppliedDiscount = {
  readonly code: string;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
};

export type ApplyDiscountError =
  | { readonly code: "below_minimum"; readonly minimumCents: number }
  | {
      readonly code: "discount_refused";
      readonly reason: DiscountRefusal;
      readonly minimumGapCents?: number;
    }
  // `merged`: a guest cart still waits to join the account cart, so Pay would reload the form.
  | { readonly code: "cart_changed"; readonly merged?: true };

const inputSchema = z.object({ code: z.unknown(), email: z.unknown().optional() });

// spec 0014, AC-1, AC-3 and AC-17: read only. The cart comes from the signed cookie and every
// price, setting and code row from the database; the answer carries the totals or a refusal
// reason, never a code's limits, counts or note. Pay checks everything again under the lock.
export async function applyDiscountCode(
  input: unknown,
): Promise<ActionResult<AppliedDiscount, ApplyDiscountError>> {
  const parsed = inputSchema.safeParse(input);
  const { code, email: typedEmail } = parsed.success ? parsed.data : { code: null, email: null };

  const customer = await getCustomer();
  const cartId = await readOwnedCartId();
  if (cartId === null) return { ok: false, error: { code: "cart_changed" } };
  // The same cart /checkout renders. A signed in customer's guest cookie cart joins the account
  // cart only on Pay; when the account cart holds lines too, Pay would send the form back.
  if (customer !== null && (await waitsToMerge(cartId, customer.id))) {
    return { ok: false, error: { code: "cart_changed", merged: true } };
  }

  // AC-3, check 5 runs only when the email is known: the account's, or a valid typed one.
  const typed = emailSchema.safeParse(typedEmail);
  const email = customer?.email ?? (typed.success ? typed.data : null);

  const preview = await previewDiscount({ cartId, codeText: code, email });
  switch (preview.kind) {
    case "no_cart":
      return { ok: false, error: { code: "cart_changed" } };
    case "below_minimum":
      return { ok: false, error: { code: "below_minimum", minimumCents: preview.minimumCents } };
    case "refused":
      logDiscountRefused({
        stage: "apply",
        reason: preview.reason,
        discountCodeId: preview.codeId,
      });
      return {
        ok: false,
        error: {
          code: "discount_refused",
          reason: preview.reason,
          ...(preview.minimumGapCents === undefined
            ? {}
            : { minimumGapCents: preview.minimumGapCents }),
        },
      };
    case "applied":
      return {
        ok: true,
        data: {
          code: preview.code,
          discountCents: preview.discountCents,
          shippingCents: preview.shippingCents,
          totalCents: preview.totalCents,
        },
      };
  }
}

async function waitsToMerge(cartId: string, customerId: string): Promise<boolean> {
  const cart = await db.cart.findUnique({ where: { id: cartId }, select: { customerId: true } });
  if (cart === null || cart.customerId !== null) return false;
  const lines = await db.cartItem.count({ where: { cart: { customerId } } });
  return lines > 0;
}
