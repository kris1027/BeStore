import { z } from "zod";

import { storeCountries } from "./shipping/address";

// Validated once at server start (see instrumentation.ts), so a missing variable fails fast.
const envSchema = z
  .object({
    DATABASE_URL: postgresUrl(),
    DIRECT_URL: postgresUrl(),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    CART_COOKIE_SECRET: z.string().min(32),
    // Vercel Cron sends it as `Authorization: Bearer <secret>` (spec 0001).
    CRON_SECRET: z.string().min(32),
    NEXT_PUBLIC_SITE_URL: z.url(),
    // Test keys everywhere but production (spec 0006). A restricted key (rk_) works too.
    STRIPE_SECRET_KEY: z
      .string()
      .regex(/^(sk|rk)_(test|live)_\w+$/, "Stripe secret key, e.g. sk_test_..."),
    // One per webhook endpoint; locally the one `stripe listen` prints.
    STRIPE_WEBHOOK_SECRET: z
      .string()
      .regex(/^whsec_\w+$/, "Stripe webhook signing secret, e.g. whsec_..."),
    STORE_CURRENCY: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. EUR"),
    // The one country the store ships to (spec 0007). Only countries with a postal code rule in
    // src/lib/shipping/address.ts are accepted, so a new one fails here instead of taking any code.
    STORE_COUNTRY: z.enum(storeCountries, "ISO 3166 alpha 2 code of a supported country, e.g. PL"),
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
    // spec 0011, AC-16: `log` sends nothing (local, tests, CI); production must use `resend`.
    // spec 0012, AC-23: `mailpit` hands every email to the local stack's Mailpit (e2e, CI).
    EMAIL_TRANSPORT: z.enum(["log", "resend", "mailpit"]),
    // Mailpit's base URL; required when EMAIL_TRANSPORT is mailpit.
    MAILPIT_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
    // spec 0012, AC-8: the Standard Webhooks secret Supabase signs the Send Email Hook with.
    SEND_EMAIL_HOOK_SECRET: z
      .string()
      .regex(/^v1,whsec_[A-Za-z0-9+/]+={0,2}$/, "Standard Webhooks secret, e.g. v1,whsec_..."),
    // A sending only key; required when EMAIL_TRANSPORT is resend.
    RESEND_API_KEY: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .regex(/^re_\w+$/, "Resend API key, e.g. re_...")
        .optional(),
    ),
    // Sender and reply mailbox: `Name <address>` or a bare address, on a domain verified in Resend.
    EMAIL_FROM: z.string().refine((v) => fromAddress(v) !== null, {
      error: "Sender, e.g. Shop <orders@example.com> or orders@example.com",
    }),
  })
  .superRefine((value, ctx) => {
    if (value.EMAIL_TRANSPORT !== "resend" && value.VERCEL_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_TRANSPORT"],
        message: "Must be resend in production, or customers get no email",
      });
    }
    if (value.EMAIL_TRANSPORT === "mailpit" && value.MAILPIT_URL === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["MAILPIT_URL"],
        message: "Required when EMAIL_TRANSPORT is mailpit",
      });
    }
    if (value.EMAIL_TRANSPORT === "resend" && value.RESEND_API_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "Required when EMAIL_TRANSPORT is resend",
      });
    }
  })
  // The footer's contact address (spec 0011, AC-7), parsed once here.
  .transform((value) => ({ ...value, EMAIL_FROM_ADDRESS: fromAddress(value.EMAIL_FROM) ?? "" }));

const emailAddress = z.email();

// The address part of `Name <address>` or of a bare address; null when it is not one.
function fromAddress(value: string): string | null {
  const match = /^\s*(?:[^<>]*<([^<>\s]+)>|([^<>\s]+))\s*$/.exec(value);
  const address = match?.[1] ?? match?.[2];
  return address !== undefined && emailAddress.safeParse(address).success ? address : null;
}

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
