import { z } from "zod";

import { passwordSchema } from "@/lib/auth/password";

import { authMessages, fieldMessages } from "./messages";

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
