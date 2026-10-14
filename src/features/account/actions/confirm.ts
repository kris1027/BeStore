"use server";

import { redirect } from "next/navigation";

import { logAccountEvent } from "@/lib/customer/log";
import { customerIdentity } from "@/lib/customer/session";
import { runsTheStore } from "@/lib/customer/store-admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { accountPaths } from "../paths";
import { confirmLinkSchema } from "../schemas";

// The admin reset waits behind the authenticator (spec 0004): the same place /auth/confirm sends.
const adminResetPath = "/admin/mfa?next=%2Fadmin%2Freset-password";

// spec 0012, AC-2: the POST half of /account/confirm. Only a person pressing Continue spends the
// one time token, never a mail scanner that opens the link.
export async function confirmEmail(formData: FormData): Promise<void> {
  const parsed = confirmLinkSchema.safeParse({
    tokenHash: formData.get("token_hash"),
    type: formData.get("type"),
  });
  if (!parsed.success) redirect(`${accountPaths.confirm}?failed=1`);
  const { tokenHash, type } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) redirect(`${accountPaths.confirm}?failed=1&type=${type}`);

  // A password that guards /admin is never reset from an inbox alone (Key invariants), even with
  // an admin's link pasted here: it goes to the authenticator step like /auth/confirm.
  if (type === "recovery" && (await runsTheStore(data.user.id))) redirect(adminResetPath);

  if (type === "signup") {
    logAccountEvent("account.confirmed", { customerId: customerIdentity(data.user)?.id ?? null });
  }
  redirect(
    type === "recovery" ? `${accountPaths.setPassword}?from=reset` : accountPaths.setPassword,
  );
}
