import { z } from "zod";

// Validated once at server start (see instrumentation.ts), so a missing variable fails fast.
// Variables owned by later features join this schema when that feature lands:
// STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (7) · RESEND_API_KEY, EMAIL_FROM (11).
const envSchema = z.object({
  DATABASE_URL: postgresUrl(),
  DIRECT_URL: postgresUrl(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CART_COOKIE_SECRET: z.string().min(32),
  // Vercel Cron sends it as `Authorization: Bearer <secret>` (spec 0001).
  CRON_SECRET: z.string().min(32),
  NEXT_PUBLIC_SITE_URL: z.url(),
  STORE_CURRENCY: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. EUR"),
  STORE_TIMEZONE: z.string().refine(isIanaTimezone, "IANA timezone, e.g. Europe/Warsaw"),
  // Language and number, price and date formats; also <html lang>.
  STORE_LOCALE: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .refine(isSupportedLocale, "BCP 47 language tag that Intl supports, e.g. en, en-GB, pl-PL")
      .transform((tag) => Intl.getCanonicalLocales(tag)[0] ?? tag)
      .default("en"),
  ),
  // Set by Vercel (production, preview, development); unset locally. Gates /style-guide.
  VERCEL_ENV: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["production", "preview", "development"]).optional(),
  ),
  // Only `pnpm test:db` uses it (the app never does); it must never be the dev or a deployed database.
  // A blank line (as copied from .env.example) means unset, not an invalid URL.
  TEST_DATABASE_URL: z.preprocess((v) => (v === "" ? undefined : v), postgresUrl().optional()),
});

function postgresUrl() {
  return z.url({
    protocol: /^postgres(ql)?$/,
    error: "PostgreSQL connection string (postgresql://...)",
  });
}

// Intl also accepts fixed offsets ("+02:00"), legacy abbreviations ("EST") and any casing,
// which either ignore daylight saving or mean something else to Postgres `AT TIME ZONE`.
// Only the Area/Location form (not the fixed-offset Etc/ zones) or UTC is allowed.
function isIanaTimezone(value: string) {
  if (value === "UTC") return true;
  if (!/^[A-Z][A-Za-z]*(\/[A-Z][A-Za-z0-9_+-]*)+$/.test(value) || value.startsWith("Etc/"))
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// supportedLocalesOf throws on a malformed tag and drops a well formed one Intl has no data for.
function isSupportedLocale(value: string) {
  try {
    return Intl.NumberFormat.supportedLocalesOf(value).length === 1;
  } catch {
    return false;
  }
}

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const env = parseEnv();
