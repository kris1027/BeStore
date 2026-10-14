import "server-only";

import { lineCap } from "@/lib/availability";
import type { Tx } from "@/lib/db";

import { cartExpiry } from "./cookie";

export type MergeOutcome = {
  // The cart the cookie names from now on, or null for none.
  readonly cartId: string | null;
  readonly expiresAt: Date;
  // Guest lines that went into the account cart.
  readonly linesMoved: number;
  // The account cart already held lines, so the merged cart differs from the guest one the
  // visitor saw (spec 0012, AC-15: checkout then asks them to look again).
  readonly accountHadLines: boolean;
};

type LockedCart = { readonly id: string; readonly customer_id: string | null };

// spec 0012, AC-5: the guest cart named by the cookie joins the customer's cart. The caller holds
// the customer lock (src/lib/customer/lock.ts); the carts are then locked here, so two sign ins of
// one account, or a sign in and an add to cart, never leave two account carts.
export async function mergeCarts(
  tx: Tx,
  customerId: string,
  cookieCartId: string | null,
  nowMs: number,
): Promise<MergeOutcome> {
  const expiresAt = cartExpiry(nowMs);
  const cookieCart =
    cookieCartId === null
      ? null
      : ((
          await tx.$queryRaw<LockedCart[]>`
            SELECT id, customer_id FROM carts
            WHERE id = ${cookieCartId}::uuid AND expires_at > now() FOR UPDATE`
        )[0] ?? null);
  // A cookie naming another customer's cart is ignored, and replaced below.
  const guest = cookieCart !== null && cookieCart.customer_id === null ? cookieCart : null;

  const account = await lockAccountCart(tx, customerId);
  const done = async (cartId: string | null, linesMoved = 0, accountHadLines = false) => {
    if (cartId !== null) await tx.cart.update({ where: { id: cartId }, data: { expiresAt } });
    return { cartId, expiresAt, linesMoved, accountHadLines };
  };

  if (guest === null) return done(account);
  if (account === null) {
    await tx.cart.update({ where: { id: guest.id }, data: { customerId } });
    return done(guest.id);
  }

  const [guestLines, accountLines] = await Promise.all([
    cartLines(tx, guest.id),
    cartLines(tx, account),
  ]);
  for (const line of guestLines) {
    const cap = line.available ? lineCap(line.stockQuantity) : 0;
    const existing = accountLines.find((other) => other.variantId === line.variantId);
    if (existing) {
      // An archived or sold out variant keeps the account's line as it is.
      if (cap > 0) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: Math.min(existing.quantity + line.quantity, cap) },
        });
      }
      continue;
    }
    // A moved line keeps its row (and its place in the cart); flags are computed at read time.
    await tx.cartItem.update({
      where: { id: line.id },
      data: { cartId: account, ...(cap > 0 ? { quantity: Math.min(line.quantity, cap) } : {}) },
    });
  }
  // The rest of the guest cart's lines go with it. A pending order on it keeps its row with
  // cart_id null, as when the expired cart cron deletes a cart.
  await tx.cart.delete({ where: { id: guest.id } });
  return done(account, guestLines.length, accountLines.length > 0);
}

// The customer's cart, locked; the caller holds the customer lock. One that has expired but not
// been swept yet is deleted, so the customer starts a fresh one (carts.customer_id is unique).
export async function lockAccountCart(tx: Tx, customerId: string): Promise<string | null> {
  const [row] = await tx.$queryRaw<{ id: string; live: boolean }[]>`
    SELECT id, expires_at > now() AS live FROM carts
    WHERE customer_id = ${customerId}::uuid FOR UPDATE`;
  if (row === undefined) return null;
  if (row.live) return row.id;
  await tx.cart.delete({ where: { id: row.id } });
  return null;
}

async function cartLines(tx: Tx, cartId: string) {
  const items = await tx.cartItem.findMany({
    where: { cartId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      variantId: true,
      quantity: true,
      variant: {
        select: { stockQuantity: true, archived: true, product: { select: { status: true } } },
      },
    },
  });
  return items.map(({ variant, ...item }) => ({
    ...item,
    stockQuantity: variant.stockQuantity,
    available: !variant.archived && variant.product.status === "active",
  }));
}
