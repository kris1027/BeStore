import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

// The stack suites (`pnpm test:stack`) run against the local Supabase CLI stack: they need its
// auth schema, which the plain Postgres of `pnpm test:db` does not have. They only add users
// with unique emails, and refuse to run against anything but a local stack.
config({ path: [".env.local", ".env"], quiet: true });

export function stackEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error("The stack tests only run against a local Supabase stack.");
  }
  return {
    url,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

export function uniqueEmail() {
  return `stack-${randomUUID()}@example.com`;
}

export const stackPassword = "Correct-horse-9";

export function anonClient(): SupabaseClient {
  const env = stackEnv();
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient(): SupabaseClient {
  const env = stackEnv();
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
