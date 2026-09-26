import { z } from "zod";

import { authMessages, fieldMessages, passwordRuleMessages, type PasswordRule } from "./messages";

// Pure (no server-only imports): the admin scripts share passwordSchema with the app.

// Supabase's `lower_upper_letters_digits_symbols` policy counts only these as symbols, so the
// schema uses the same set; a password that passes here also passes the Auth server (AC-10).
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

// One issue per missing part, so the form can name each of them.
export const passwordSchema = z.string().superRefine((value, ctx) => {
  for (const rule of missingPasswordRules(value)) {
    ctx.addIssue({ code: "custom", message: passwordRuleMessages[rule] });
  }
});

export const emailSchema = z
  .string()
  .trim()
  .min(1, fieldMessages.emailRequired)
  .pipe(z.email(fieldMessages.emailInvalid))
  .transform((email) => email.toLowerCase());

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, fieldMessages.passwordRequired),
});

export type SignInValues = z.input<typeof signInSchema>;

export const totpCodeSchema = z.object({
  // Authenticator apps show the code as "123 456"; spaces are dropped before checking.
  code: z
    .string()
    .transform((code) => code.replace(/\s/g, ""))
    .pipe(z.string().regex(/^\d{6}$/, fieldMessages.codeRequired)),
});

export type TotpCodeValues = z.input<typeof totpCodeSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export type ForgotPasswordValues = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: authMessages.mismatch,
  });

export type ResetPasswordValues = z.input<typeof resetPasswordSchema>;
