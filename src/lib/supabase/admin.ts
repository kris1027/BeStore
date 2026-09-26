import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

// Service role client for Storage only (signed upload URLs, existence checks). It bypasses
// every policy, so it never leaves the server and is created only after requireAdmin().
export function createSupabaseAdminClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
