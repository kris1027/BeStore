import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { clearAuthCookies } from "./server";

// Ends the session on this device only. Never the default `global` scope, which would also end
// the user's sessions on their other devices (spec 0004).
export async function endLocalSession(supabase: SupabaseClient) {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  // auth-js keeps the local session when the Auth server call fails, so clear it by hand.
  if (error) await clearAuthCookies();
}
