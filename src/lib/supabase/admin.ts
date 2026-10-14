import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

// Service role client for Storage (signed upload URLs, existence checks, after requireAdmin()) and
// for deleting a customer's own login (spec 0012, AC-20, after requireCustomer() and their
// password). It bypasses every policy, so it never leaves the server.
export function createSupabaseAdminClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
