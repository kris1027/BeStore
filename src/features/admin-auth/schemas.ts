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
