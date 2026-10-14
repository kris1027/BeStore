import "server-only";

import { clearCartCookie, readCartId, setCartCookie } from "@/lib/cart/cookie";
import { type MergeOutcome, mergeCarts } from "@/lib/cart/merge";
import { db, type Tx } from "@/lib/db";

import { lockCustomer } from "./lock";
import { logAccountEvent } from "./log";

// A confirmed Supabase user as this store knows them: the auth user id and the lower cased email.
export type CustomerIdentity = { readonly id: string; readonly email: string };

// spec 0012, AC-10: makes sure the customers row exists and carries the auth email. Another row
// holding the email is removed first only when its auth user is gone (an account deleted after a
// failed commit, AC-20); a live one is a conflict the caller reports. Runs under the lock.
export async function ensureCustomerRow(tx: Tx, customer: CustomerIdentity): Promise<boolean> {
  const holder = await tx.customer.findUnique({
    where: { email: customer.email },
    select: { id: true },
  });
  if (holder && holder.id !== customer.id) {
    // auth.users is Supabase's own table: read only.
    const live = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM auth.users WHERE id = ${holder.id}::uuid`;
    if (live.length > 0) return false;
    await tx.customer.delete({ where: { id: holder.id } });
  }
  await tx.customer.upsert({
    where: { id: customer.id },
    create: { id: customer.id, email: customer.email },
    update: { email: customer.email },
    select: { id: true },
  });
  return true;
}

// AC-10 (2): every guest order placed with this email joins the account. Checkout stores the email
// lower cased, so equality is enough. Unpaid ones stay hidden by the history query, not here.
export async function linkGuestOrders(tx: Tx, customer: CustomerIdentity): Promise<number> {
  const { count } = await tx.order.updateMany({
    where: { email: customer.email, customerId: null },
    data: { customerId: customer.id },
  });
  return count;
}

export type SetupOutcome =
  | { readonly ok: true; readonly linked: number; readonly merge: MergeOutcome }
  | { readonly ok: false; readonly error: "email_conflict" };

// "Account setup" (AC-10): after choosing a password and after every sign in, in one transaction
// under the customer lock: the row, the order links, then the cart merge (AC-5). The identity
// comes from the user Supabase just returned, never from a cookie read in the same request.
export async function accountSetup(customer: CustomerIdentity): Promise<SetupOutcome> {
  const cookieCartId = await readCartId();
  const outcome = await db.$transaction(async (tx): Promise<SetupOutcome> => {
    await lockCustomer(tx, customer.id);
    if (!(await ensureCustomerRow(tx, customer))) return { ok: false, error: "email_conflict" };
    const linked = await linkGuestOrders(tx, customer);
    const merge = await mergeCarts(tx, customer.id, cookieCartId, Date.now());
    return { ok: true, linked, merge };
  });
  if (!outcome.ok) {
    logAccountEvent("account.email_conflict", { customerId: customer.id });
    return outcome;
  }
  await finishMerge(customer.id, cookieCartId, outcome.merge);
  if (outcome.linked > 0) {
    logAccountEvent("account.orders_linked", { customerId: customer.id, count: outcome.linked });
  }
  return outcome;
}

// The cart merge on its own (AC-5), for checkout (AC-15): under the customer lock, then the cookie.
export async function mergeCartForCustomer(customerId: string): Promise<MergeOutcome> {
  const cookieCartId = await readCartId();
  const merge = await db.$transaction(async (tx) => {
    await lockCustomer(tx, customerId);
    return mergeCarts(tx, customerId, cookieCartId, Date.now());
  });
  await finishMerge(customerId, cookieCartId, merge);
  return merge;
}

// Every merge renews the cookie with the cart's own expiry; with no cart left, a cookie that
// named someone else's cart is dropped.
async function finishMerge(customerId: string, cookieCartId: string | null, merge: MergeOutcome) {
  if (merge.cartId !== null) await setCartCookie(merge.cartId, merge.expiresAt);
  else if (cookieCartId !== null) await clearCartCookie();
  if (merge.linesMoved > 0) {
    logAccountEvent("account.cart_merged", { customerId, lines: merge.linesMoved });
  }
}
