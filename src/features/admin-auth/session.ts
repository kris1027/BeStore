import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { clearAuthCookies } from "@/lib/supabase/server";

// Ends the session on this device only. Never the default `global` scope, which would also end
// a customer's sessions on their other devices (spec 0004).
export async function endLocalSession(supabase: SupabaseClient) {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  // auth-js keeps the local session when the Auth server call fails, so clear it by hand.
  if (error) await clearAuthCookies();
}

// Field errors from a failed Zod parse, keyed by field name.
export function fieldErrors<T extends string>(
  error: z.ZodError,
): Partial<Record<T, readonly string[]>> {
  return z.flattenError(error).fieldErrors as Partial<Record<T, readonly string[]>>;
}
