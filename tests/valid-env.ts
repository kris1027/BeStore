import { vi } from "vitest";

// A complete, valid set of the variables src/lib/env.ts requires, for unit tests.
export const validEnv = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres?pgbouncer=true",
  DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CART_COOKIE_SECRET: "a".repeat(32),
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  STORE_CURRENCY: "EUR",
  STORE_TIMEZONE: "Europe/Warsaw",
} as const;

export type EnvKey = keyof typeof validEnv;

export function stubEnv(overrides: Partial<Record<EnvKey, string | undefined>> = {}) {
  // Clear optional variables too, so one set in the shell (CI sets TEST_DATABASE_URL job
  // wide) cannot leak into the parsed env.
  vi.stubEnv("TEST_DATABASE_URL", undefined);
  const values = { ...validEnv, ...overrides };
  for (const key of Object.keys(values) as EnvKey[]) {
    vi.stubEnv(key, values[key]);
  }
}
