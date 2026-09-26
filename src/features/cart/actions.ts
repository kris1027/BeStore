"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { lineCap, MAX_LINE_QUANTITY } from "@/lib/availability";
import { cartExpiry, readCartId, setCartCookie } from "@/lib/cart/cookie";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/result";

export type AddToCartError = "invalid" | "unavailable" | "sold_out";

export type AddToCartData = {
  readonly lineQuantity: number;
  readonly cartQuantity: number;
  // Set when the request asked for more than the line may hold ("Only N available").
  readonly cappedTo?: number;
};

// Never a price: the price always comes from the database (spec 0005, AC-15).
const addToCartSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

// Locks the cart row so two tabs writing at once cannot push a line past its cap. Returns the
// id when the cart exists and has not expired.
async function lockLiveCart(tx: Tx, cartId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM carts WHERE id = ${cartId}::uuid AND expires_at > now() FOR UPDATE`;
  return rows[0]?.id ?? null;
}

// spec 0005, AC-8 and AC-9: the first add creates the cart and sets the cookie; later adds
// grow the line up to the variant's stock or 10.
export async function addToCart(
  input: unknown,
): Promise<ActionResult<AddToCartData, AddToCartError>> {
  const parsed = addToCartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { variantId, quantity } = parsed.data;

  const cookieCartId = await readCartId();
  const nowMs = Date.now();
  const expiresAt = cartExpiry(nowMs);

  const result = await db.$transaction(
    async (
      tx,
    ): Promise<ActionResult<AddToCartData & { readonly cartId: string }, AddToCartError>> => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { stockQuantity: true, archived: true, product: { select: { status: true } } },
      });
      if (!variant || variant.archived || variant.product.status !== "active") {
        return { ok: false, error: "unavailable" };
      }
      const cap = lineCap(variant.stockQuantity);
      if (cap === 0) return { ok: false, error: "sold_out" };

      const liveCartId = cookieCartId === null ? null : await lockLiveCart(tx, cookieCartId);
      const cartId = liveCartId
        ? (
            await tx.cart.update({
              where: { id: liveCartId },
              data: { expiresAt },
              select: { id: true },
            })
          ).id
        : (await tx.cart.create({ data: { expiresAt }, select: { id: true } })).id;

      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId, variantId } },
        select: { quantity: true },
      });
      const wanted = (existing?.quantity ?? 0) + quantity;
      const lineQuantity = Math.min(wanted, cap);
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId, variantId } },
        create: { cartId, variantId, quantity: lineQuantity },
        update: { quantity: lineQuantity },
        select: { id: true },
      });
      const total = await tx.cartItem.aggregate({ where: { cartId }, _sum: { quantity: true } });

      return {
        ok: true,
        data: {
          cartId,
          lineQuantity,
          cartQuantity: total._sum.quantity ?? lineQuantity,
          ...(lineQuantity < wanted ? { cappedTo: lineQuantity } : {}),
        },
      };
    },
  );
  if (!result.ok) return result;

  const { cartId, ...data } = result.data;
  // Renewed on every write, with the cart's own expiry (AC-9).
  await setCartCookie(cartId, expiresAt);
  // The header count and an open cart page rerender with the new line.
  refresh();
  return { ok: true, data };
}

export type CartLineError = "invalid" | "not_found" | "unavailable" | "sold_out";

const setQuantitySchema = z.object({
  itemId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

const removeSchema = z.object({ itemId: z.uuid() });

// Runs `write` on the cookie's live cart, locked, then renews the cart and its cookie. A line id
// from any other cart reads as not found (spec 0005, AC-15).
async function withCookieCart<T>(
  write: (tx: Tx, cartId: string) => Promise<ActionResult<T, CartLineError>>,
): Promise<ActionResult<T, CartLineError>> {
  const cookieCartId = await readCartId();
  if (cookieCartId === null) return { ok: false, error: "not_found" };
  const expiresAt = cartExpiry(Date.now());

  const result = await db.$transaction(async (tx) => {
    const cartId = await lockLiveCart(tx, cookieCartId);
    if (cartId === null) return { ok: false as const, error: "not_found" as const };
    const outcome = await write(tx, cartId);
    if (outcome.ok) await tx.cart.update({ where: { id: cartId }, data: { expiresAt } });
    return outcome;
  });
  if (!result.ok) return result;

  await setCartCookie(cookieCartId, expiresAt);
  refresh();
  return result;
}

// spec 0005, AC-10: the same caps as adding. A line whose variant sold out since it was added
// has a cap of 0, which the quantity CHECK refuses, so it is answered as sold out untouched.
export async function setCartItemQuantity(
  input: unknown,
): Promise<
  ActionResult<{ readonly lineQuantity: number; readonly cappedTo?: number }, CartLineError>
> {
  const parsed = setQuantitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { itemId, quantity } = parsed.data;

  return withCookieCart(async (tx, cartId) => {
    const item = await tx.cartItem.findFirst({
      where: { id: itemId, cartId },
      select: {
        variant: {
          select: { stockQuantity: true, archived: true, product: { select: { status: true } } },
        },
      },
    });
    if (!item) return { ok: false, error: "not_found" };
    const { variant } = item;
    if (variant.archived || variant.product.status !== "active") {
      return { ok: false, error: "unavailable" };
    }
    const cap = lineCap(variant.stockQuantity);
    if (cap === 0) return { ok: false, error: "sold_out" };

    const lineQuantity = Math.min(quantity, cap);
    await tx.cartItem.update({ where: { id: itemId }, data: { quantity: lineQuantity } });
    return {
      ok: true,
      data: { lineQuantity, ...(lineQuantity < quantity ? { cappedTo: lineQuantity } : {}) },
    };
  });
}

export async function removeCartItem(
  input: unknown,
): Promise<ActionResult<Record<string, never>, CartLineError>> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { itemId } = parsed.data;

  return withCookieCart(async (tx, cartId) => {
    const { count } = await tx.cartItem.deleteMany({ where: { id: itemId, cartId } });
    return count === 0 ? { ok: false, error: "not_found" } : { ok: true, data: {} };
  });
}
