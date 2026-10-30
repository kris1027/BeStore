"use server";

import { redirect } from "next/navigation";

import { classifyAuthError } from "@/lib/auth/errors";
import { logAccountEvent } from "@/lib/customer/log";
import { customerIdentity } from "@/lib/customer/session";
import { accountSetup } from "@/lib/customer/setup";
import { runsTheStore } from "@/lib/customer/store-admin";
import { fieldErrors } from "@/lib/form-errors";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { accountPaths } from "../paths";
import { type PasswordUpdateError, passwordUpdateError } from "../password-errors";
import { newPasswordSchema } from "../schemas";

export type SetPasswordError = {
  readonly form?: PasswordUpdateError | "session_missing" | "runs_the_store" | "setup_failed";
  readonly fields?: Partial<Record<"password" | "confirm", readonly string[]>>;
};

// spec 0012, AC-3: the customer chooses their password after confirming (or after a reset link),
// so only someone with the inbox ever sets it. Every other session of the user ends, account setup
// runs (AC-10), and the customer lands on /account.
export async function setPassword(
  values: unknown,
  from: unknown,
): Promise<ActionResult<never, SetPasswordError>> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: { form: "session_missing" } };

  const parsed = newPasswordSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: fieldErrors(parsed.error) } };

  // A password that guards /admin changes only from the terminal (spec 0019, AC-10).
  if (await runsTheStore(user.id)) return { ok: false, error: { form: "runs_the_store" } };

  const { data, error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const reason = passwordUpdateError(error);
    if (reason === "weak_password") {
      logger.error({ customerId: user.id }, "account.password.policy_mismatch");
    }
    return { ok: false, error: { form: reason } };
  }

  // Whoever else holds a session is signed out. The password is set either way; a failed revoke
  // is logged because those sessions may still be live.
  const { error: revokeError } = await supabase.auth.signOut({ scope: "others" });
  if (revokeError) {
    logger.error(
      { customerId: user.id, reason: classifyAuthError(revokeError) },
      "account.password.revoke_others_failed",
    );
  }

  const identity = customerIdentity(data.user);
  if (identity === null) return { ok: false, error: { form: "session_missing" } };
  const setup = await accountSetup(identity);
  if (!setup.ok) return { ok: false, error: { form: "setup_failed" } };

  const reset = from === "reset";
  if (reset) logAccountEvent("account.password_reset", { customerId: identity.id });
  redirect(`${accountPaths.home}?notice=${reset ? "password_changed" : "ready"}`);
}
