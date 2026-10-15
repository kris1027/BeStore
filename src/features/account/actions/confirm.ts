"use server";

import { redirect } from "next/navigation";

import { classifyAuthError } from "@/lib/auth/errors";
import { logAccountEvent } from "@/lib/customer/log";
import { customerIdentity } from "@/lib/customer/session";
import { runsTheStore } from "@/lib/customer/store-admin";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { accountPaths } from "../paths";
import { confirmLinkSchema } from "../schemas";
import { throwawayPassword } from "../throwaway-password";

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

  // A password that guards /admin is never changed from an inbox alone (Key invariants), even with
  // an admin's link pasted here: a reset goes to the authenticator step like /auth/confirm, and a
  // sign up keeps the admin's password as it is.
  const storeAdmin = await runsTheStore(data.user.id);
  if (type === "recovery" && storeAdmin) redirect(adminResetPath);

  if (type === "signup") {
    if (!storeAdmin) await dropPlantedPassword(supabase, data.user.id);
    logAccountEvent("account.confirmed", { customerId: customerIdentity(data.user)?.id ?? null });
  }
  redirect(
    type === "recovery" ? `${accountPaths.setPassword}?from=reset` : accountPaths.setPassword,
  );
}

// AC-1 and AC-3: Supabase sign up is public, so anyone can create the unconfirmed user straight
// through the API with a password they know, and this confirm makes that password work. Replacing
// it here means only a password chosen after the confirm can sign in, even when the customer
// leaves set password without choosing one. A sign in that slipped in since verifyOtp is ended.
async function dropPlantedPassword(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  customerId: string,
): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: throwawayPassword() });
  if (error) {
    // The customer still goes on to set password, which replaces it; the log flags the gap.
    logger.error(
      { customerId, reason: classifyAuthError(error) },
      "account.confirm.password_replace_failed",
    );
    return;
  }
  const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
  if (revokeError) {
    logger.error(
      { customerId, reason: classifyAuthError(revokeError) },
      "account.confirm.revoke_others_failed",
    );
  }
}
