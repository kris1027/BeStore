"use server";

import { redirect, RedirectType } from "next/navigation";

import { classifyAuthError } from "@/lib/auth/errors";
import { clearCartCookie } from "@/lib/cart/cookie";
import { logAccountEvent } from "@/lib/customer/log";
import { customerIdentity } from "@/lib/customer/session";
import { accountSetup } from "@/lib/customer/setup";
import { fieldErrors } from "@/lib/form-errors";
import type { ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { endLocalSession } from "@/lib/supabase/session";

import { accountPaths, safeAccountNext } from "../paths";
import { signInSchema } from "../schemas";

export type SignInError = {
  readonly form?: "invalid_credentials" | "rate_limited" | "unavailable";
  readonly fields?: Partial<Record<"email" | "password", readonly string[]>>;
};

// spec 0012, AC-4: one message for a wrong password, an unknown email and an unconfirmed account.
// On success, account setup (AC-10) links guest orders and merges the cart, then the customer goes
// to a safe `next` or to /account.
export async function signInCustomer(
  values: unknown,
  next: unknown,
): Promise<ActionResult<never, SignInError>> {
  const parsed = signInSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };

  const supabase = await createSupabaseServerClient();
  // A customer sign in never replaces a live session, an admin's included (AC-4).
  const {
    data: { user: current },
  } = await supabase.auth.getUser();
  if (current) redirect(accountPaths.home);

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    const failure = classifyAuthError(error);
    const reason = failure === "rejected" ? "invalid_credentials" : failure;
    logAccountEvent("account.sign_in_failed", { reason });
    return { ok: false, error: { form: reason } };
  }

  const identity = customerIdentity(data.user);
  if (identity === null) {
    await endLocalSession(supabase);
    logAccountEvent("account.sign_in_failed", { reason: "unconfirmed" });
    return { ok: false, error: { form: "invalid_credentials" } };
  }
  const setup = await accountSetup(identity);
  if (!setup.ok) {
    await endLocalSession(supabase);
    logAccountEvent("account.sign_in_failed", { customerId: identity.id, reason: "setup_failed" });
    return { ok: false, error: { form: "unavailable" } };
  }

  logAccountEvent("account.sign_in", { customerId: identity.id });
  redirect(safeAccountNext(next) ?? accountPaths.home);
}

// AC-6: this browser only. The account cart stays in the database for the next sign in. Admins and
// customers share one session per browser, so this also ends an admin session here.
export async function signOutCustomer(): Promise<void> {
  await endLocalSession(await createSupabaseServerClient());
  await clearCartCookie();
  redirect("/", RedirectType.replace);
}
