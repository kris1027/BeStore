import { z } from "zod";

// Pure (no server-only imports): the account pages and the admin scripts check passwords with
// this schema, which mirrors the project wide Supabase policy (spec 0004, AC-10;
// supabase/config.toml `password_requirements`). Keep the two in step.

export const passwordRuleMessages = {
  length: "At least 8 characters",
  lower: "A lower case letter",
  upper: "An upper case letter",
  digit: "A digit",
  symbol: "A symbol",
} as const;

export type PasswordRule = keyof typeof passwordRuleMessages;

// bcrypt reads only the first 72 bytes, and Supabase refuses anything longer.
export const PASSWORD_MAX_BYTES = 72;

export const passwordTooLongMessage = "Use at most 72 characters (fewer with accents or emoji).";

// Supabase's `lower_upper_letters_digits_symbols` policy counts only these as symbols, so the
// schema uses the same set; a password that passes here also passes the Auth server.
const symbols = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

const passwordRules: readonly (readonly [PasswordRule, (value: string) => boolean])[] = [
  ["length", (value) => value.length >= 8],
  ["lower", (value) => /[a-z]/.test(value)],
  ["upper", (value) => /[A-Z]/.test(value)],
  ["digit", (value) => /[0-9]/.test(value)],
  ["symbol", (value) => [...value].some((char) => symbols.includes(char))],
];

export function missingPasswordRules(value: string): PasswordRule[] {
  return passwordRules.filter(([, passes]) => !passes(value)).map(([rule]) => rule);
}

export function isPasswordTooLong(value: string): boolean {
  return new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES;
}

// One issue per missing part, so a form can name each of them.
export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const rule of missingPasswordRules(value)) {
    ctx.addIssue({ code: "custom", message: passwordRuleMessages[rule] });
  }
  if (isPasswordTooLong(value)) ctx.addIssue({ code: "custom", message: passwordTooLongMessage });
});

// Admin passwords (spec 0019, AC-16): the password is the only factor in front of `/admin`, so
// length is the cheapest defense against guessing that slips past rate limits. Only the admin
// scripts set one; the customer forms refuse store runners.
export const ADMIN_PASSWORD_MIN_LENGTH = 14;

export const adminPasswordLengthMessage = `At least ${ADMIN_PASSWORD_MIN_LENGTH} characters`;

export const adminPasswordSchema = passwordSchema.superRefine((value, ctx) => {
  if (value.length < ADMIN_PASSWORD_MIN_LENGTH) {
    ctx.addIssue({ code: "custom", message: adminPasswordLengthMessage });
  }
});

// The rule list a form prints under a new password field.
export const passwordRuleList = Object.values(passwordRuleMessages).join(", ").toLowerCase();
