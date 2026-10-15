"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { clearCartCookie } from "@/lib/cart/cookie";
import { lockCustomer } from "@/lib/customer/lock";
import { logAccountEvent } from "@/lib/customer/log";
import { requireCustomer } from "@/lib/customer/session";
import { runsTheStore } from "@/lib/customer/store-admin";
import { db } from "@/lib/db";
import { pgErrorCode } from "@/lib/db-errors";
import { fieldErrors } from "@/lib/form-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/result";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clearAuthCookies, createSupabaseServerClient } from "@/lib/supabase/server";

import { checkPassword, passwordCheckError } from "../password-check";
import { type PasswordUpdateError, passwordUpdateError } from "../password-errors";
import { changePasswordSchema, deleteAccountSchema, profileSchema } from "../schemas";

export type ProfileError = {
  readonly fields: Partial<Record<"name" | "phone", readonly string[]>>;
};

// spec 0012, AC-18: name and phone, both optional. The email is not editable here.
export async function updateProfile(
  values: unknown,
): Promise<
  ActionResult<{ readonly name: string | null; readonly phone: string | null }, ProfileError>
> {
  const customer = await requireCustomer();
  const parsed = profileSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };

  const saved = await db.customer.update({
    where: { id: customer.id },
    data: parsed.data,
    select: { name: true, phone: true },
  });
  refresh();
  return { ok: true, data: saved };
}

export type ChangePasswordError = {
  readonly form?: PasswordUpdateError | "wrong_password" | "runs_the_store";
  readonly fields?: Partial<Record<"currentPassword" | "password" | "confirm", readonly string[]>>;
};

// spec 0012, AC-19: the current password, then a new one under the AC-3 rule. Every other session
// ends and this one stays. Anyone who runs the store changes it behind the authenticator instead.
export async function changePassword(
  values: unknown,
): Promise<ActionResult<null, ChangePasswordError>> {
  const customer = await requireCustomer();
  const parsed = changePasswordSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };
  if (await runsTheStore(customer.id)) return { ok: false, error: { form: "runs_the_store" } };

  const check = await checkPassword(customer.id, customer.email, parsed.data.currentPassword);
  if (!check.ok) return { ok: false, error: { form: passwordCheckError(check.failure) } };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: { form: passwordUpdateError(error) } };
  const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
  if (revokeError) {
    logger.error({ customerId: customer.id }, "account.password.revoke_others_failed");
  }
  logAccountEvent("account.password_changed", { customerId: customer.id });
  return { ok: true, data: null };
}

function authErrorName(error: unknown): string | null {
  return error instanceof Error && typeof error.cause === "string" ? error.cause : null;
}

export type DeleteAccountError = {
  readonly form?:
    "wrong_password" | "runs_the_store" | "delete_failed" | "rate_limited" | "unavailable";
  readonly fields?: Partial<Record<"password", readonly string[]>>;
};

// spec 0012, AC-20: the profile, addresses and cart go (they cascade from the customers row) and
// the login with them; paid orders keep their snapshot with customer_id null. The auth user is
// deleted inside the transaction, before it commits, so a failed call rolls everything back.
export async function deleteAccount(
  values: unknown,
): Promise<ActionResult<never, DeleteAccountError>> {
  const customer = await requireCustomer();
  const parsed = deleteAccountSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };

  if (await runsTheStore(customer.id)) {
    logAccountEvent("account.delete_refused_admin", { customerId: customer.id });
    return { ok: false, error: { form: "runs_the_store" } };
  }

  const check = await checkPassword(customer.id, customer.email, parsed.data.password);
  if (!check.ok) return { ok: false, error: { form: passwordCheckError(check.failure) } };

  // Set once the login is gone: a failure after that point (the commit) cannot be rolled back.
  let authDeleted = false;
  try {
    await db.$transaction(
      async (tx) => {
        await lockCustomer(tx, customer.id);
        await tx.customer.deleteMany({ where: { id: customer.id } });
        const { error } = await createSupabaseAdminClient().auth.admin.deleteUser(customer.id);
        // Thrown to roll the row delete back; caught below.
        if (error) throw new Error("auth_delete_failed", { cause: error.name });
        authDeleted = true;
      },
      // Covers one round trip to the Auth server.
      { timeout: 15_000 },
    );
  } catch (error) {
    if (!authDeleted) {
      // Supabase's error name, or the SQLSTATE of a database failure; never a message, which can
      // quote the row.
      logger.error(
        { customerId: customer.id, errorName: authErrorName(error), pgCode: pgErrorCode(error) },
        "account.delete_failed",
      );
      return { ok: false, error: { form: "delete_failed" } };
    }
    // The login is gone but the rows stayed: they have no login, and account setup removes the
    // leftover row if this email signs up again (AC-10).
    logAccountEvent("account.delete_incomplete", { customerId: customer.id });
  }

  logAccountEvent("account.deleted", { customerId: customer.id });
  await clearAuthCookies();
  await clearCartCookie();
  redirect("/?notice=account_deleted");
}
