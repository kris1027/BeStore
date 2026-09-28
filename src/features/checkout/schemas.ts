import { z } from "zod";

// Shared by the checkout form (zodResolver) and startCheckout, so both refuse the same input.

export const checkoutMessages = {
  emailInvalid: "Enter a valid email address.",
} as const;

export const checkoutSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254, checkoutMessages.emailInvalid)
    .pipe(z.email(checkoutMessages.emailInvalid))
    .transform((email) => email.toLowerCase()),
});

export type CheckoutValues = z.input<typeof checkoutSchema>;

// Stripe appends `session_id` to the success URL; anything else is not one of ours.
export const sessionIdSchema = z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/);
