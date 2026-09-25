import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { type AuthFailure, classifyAuthError } from "./auth-errors";

export type TotpFactors = {
  readonly verified: { readonly id: string } | null;
  readonly unverified: readonly { readonly id: string; readonly createdAt: string }[];
};

// The factor is always looked up on the server; a factor id from the browser is never trusted.
export async function loadTotpFactors(
  supabase: SupabaseClient,
): Promise<{ ok: true; factors: TotpFactors } | { ok: false; failure: AuthFailure }> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { ok: false, failure: classifyAuthError(error) };

  const totp = data.all.filter((factor) => factor.factor_type === "totp");
  const verified = totp.find((factor) => factor.status === "verified");
  return {
    ok: true,
    factors: {
      verified: verified ? { id: verified.id } : null,
      unverified: totp
        .filter((factor) => factor.status === "unverified")
        .map((factor) => ({ id: factor.id, createdAt: factor.created_at })),
    },
  };
}

// The factor a code is checked against: the verified one, else the one being enrolled.
// enrollTotp leaves at most one unverified factor; the newest wins if that ever slips.
export function factorToVerify(factors: TotpFactors): string | null {
  if (factors.verified) return factors.verified.id;
  const newest = [...factors.unverified].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return newest?.id ?? null;
}
