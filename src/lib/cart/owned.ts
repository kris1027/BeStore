import "server-only";

import { getCustomerId } from "@/lib/customer/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

import { readCartId } from "./cookie";
import { type Cart, loadCartById } from "./load-cart";

// spec 0012, AC-7: the live cart the cookie names, when this visitor may use it. An account cart
// belongs to its customer only, so a cookie left behind by a session that ended without our sign
// out (expiry, sign out on another device, an admin sign out here) reads as no cart. Read only:
// it never clears or renews the cookie; the next successful add replaces it.
export async function readOwnedCartId(): Promise<string | null> {
  const cartId = await readCartId();
  if (cartId === null) return null;
  const cart = await db.cart.findFirst({
    where: { id: cartId, expiresAt: { gt: new Date() } },
    select: { customerId: true },
  });
  if (cart === null) return null;
  if (cart.customerId === null) return cartId;
  return (await sessionCustomerId()) === cart.customerId ? cartId : null;
}

// The cart page and checkout's owned read; the header count keeps the raw loadCart so catalog
// pages never call Supabase (AC-22).
export async function loadOwnedCart(): Promise<Cart | null> {
  const cartId = await readOwnedCartId();
  if (cartId === null) return null;
  return loadCartById(cartId, new Date());
}

// A session we cannot read only hides an account cart, never a 500.
async function sessionCustomerId(): Promise<string | null> {
  try {
    return await getCustomerId();
  } catch (error) {
    logger.warn(
      { event: "cart.owner_unknown", error: error instanceof Error ? error.name : "unknown" },
      "cart.owner_unknown",
    );
    return null;
  }
}
