import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { lockCustomer } from "./lock";
import { logAccountEvent } from "./log";
import { type CustomerIdentity, ensureCustomerRow } from "./setup";

export const accountSignInPath = "/account/sign-in";

// The identity a Supabase user stands for, or null when they have not confirmed their email.
export function customerIdentity(user: Pick<User, "id" | "email" | "email_confirmed_at">) {
  if (!user.email || !user.email_confirmed_at) return null;
  return { id: user.id, email: user.email.toLowerCase() } satisfies CustomerIdentity;
}

// spec 0012, AC-10: the signed in customer, once per request. getUser() asks the Auth server, so a
// signed out, revoked or deleted account fails at once; getClaims() would trust its token for up
// to an hour and recreate the row of a deleted account. The customers row is created or brought in
// step under the customer lock, and a live email conflict reads as signed out.
export const getCustomer = cache(async (): Promise<CustomerIdentity | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const customer = user ? customerIdentity(user) : null;
  if (customer === null) return null;

  const row = await db.customer.findUnique({ where: { id: customer.id }, select: { email: true } });
  if (row?.email === customer.email) return customer;

  const ensured = await db.$transaction(async (tx) => {
    await lockCustomer(tx, customer.id);
    return ensureCustomerRow(tx, customer);
  });
  if (!ensured) {
    logAccountEvent("account.email_conflict", { customerId: customer.id });
    return null;
  }
  return customer;
});

export async function getCustomerId(): Promise<string | null> {
  return (await getCustomer())?.id ?? null;
}

// Every account page and action below the auth pages calls this itself (AC-13); the proxy is only
// the first gate. It only returns for a signed in, confirmed customer.
export async function requireCustomer(): Promise<CustomerIdentity> {
  const customer = await getCustomer();
  if (customer === null) redirect(accountSignInPath);
  return customer;
}
