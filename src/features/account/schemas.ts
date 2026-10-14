import { z } from "zod";

import { passwordSchema } from "@/lib/auth/password";

import { accountMessages, fieldMessages } from "./messages";

// Pure: shared by the account forms (zodResolver) and their actions, so both refuse the same input.
// Every transform is safe to run twice: a form sends its parsed output and the action parses it
// again.

export const emailSchema = z
  .string({ error: fieldMessages.emailRequired })
  .trim()
  .min(1, fieldMessages.emailRequired)
  .max(254, fieldMessages.emailInvalid)
  .pipe(z.email(fieldMessages.emailInvalid))
  .transform((email) => email.toLowerCase());

export const emailFormSchema = z.object({ email: emailSchema });

export type EmailFormValues = z.input<typeof emailFormSchema>;

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: accountMessages.mismatch,
  });

export type NewPasswordValues = z.input<typeof newPasswordSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: fieldMessages.passwordRequired })
    .min(1, fieldMessages.passwordRequired),
});

export type SignInValues = z.input<typeof signInSchema>;

// The two link types /account/confirm accepts (AC-2); anything else is an invalid link.
export const confirmLinkSchema = z.object({
  tokenHash: z.string().min(1).max(512),
  type: z.enum(["signup", "recovery"]),
});

export type ConfirmLinkType = z.output<typeof confirmLinkSchema>["type"];
