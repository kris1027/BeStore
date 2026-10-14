import "server-only";

import { type AuthFailure, classifyAuthError } from "@/lib/auth/errors";
import { logger } from "@/lib/logger";
import { createSupabaseStatelessClient } from "@/lib/supabase/server";

// spec 0012, AC-19 and AC-20: change password and delete account need the current password. It is
// checked by signing in on a stateless client (no cookies), so the visitor's own session is
// untouched; the throwaway session that sign in made is ended at once with its own token. Guessing
// is limited by Supabase's per IP sign in limits and the Firewall rule (AC-26).
export async function checkPassword(
  customerId: string,
  email: string,
  password: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly failure: AuthFailure }> {
  const client = createSupabaseStatelessClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || data.user?.id !== customerId) {
    return { ok: false, failure: error ? classifyAuthError(error) : "rejected" };
  }
  const { error: signOutError } = await client.auth.signOut({ scope: "local" });
  if (signOutError) {
    logger.warn(
      { customerId, reason: classifyAuthError(signOutError) },
      "account.password_check.sign_out_failed",
    );
  }
  return { ok: true };
}
