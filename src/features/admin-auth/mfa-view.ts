import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadTotpFactors } from "./factors";
import type { AdminSession } from "./require-admin";

// `setup-pending`: a factor was enrolled but not verified yet (a reload after scanning the QR
// code), so the code form stays offered for it.
export type MfaView =
  "verify" | "setup" | "setup-pending" | "not-set-up" | "rate_limited" | "unavailable";

// Which MFA step to show: verify a factor, offer setup, or tell a reset link session with no
// factor to ask the store owner (it may never enroll one, AC-4).
export async function mfaViewFor(session: AdminSession): Promise<MfaView> {
  const loaded = await loadTotpFactors(await createSupabaseServerClient());
  if (!loaded.ok) return loaded.failure === "rate_limited" ? "rate_limited" : "unavailable";
  if (loaded.factors.verified) return "verify";
  if (session.fromResetLink) return "not-set-up";
  return loaded.factors.unverified.length > 0 ? "setup-pending" : "setup";
}
