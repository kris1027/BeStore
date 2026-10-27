import { z } from "zod";

import { fieldMessages } from "./messages";

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
