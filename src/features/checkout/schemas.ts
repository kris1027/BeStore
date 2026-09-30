import { z } from "zod";

import { shippingAddressSchema, type StoreCountry } from "@/lib/shipping/address";

// Shared by the checkout form (zodResolver) and startCheckout, so both refuse the same input.

export const checkoutMessages = {
  emailInvalid: "Enter a valid email address.",
} as const;

// Lowercasing and trimming twice gives the same email, so the server can parse the form's output.
const emailSchema = z
  .string()
  .trim()
  .max(254, checkoutMessages.emailInvalid)
  .pipe(z.email(checkoutMessages.emailInvalid))
  .transform((email) => email.toLowerCase());

export function checkoutSchema(country: StoreCountry) {
  return z.object({ email: emailSchema, ...shippingAddressSchema(country).shape });
}

export type CheckoutValues = z.input<ReturnType<typeof checkoutSchema>>;
export type CheckoutInput = z.output<ReturnType<typeof checkoutSchema>>;

export const checkoutFields = [
  "email",
  "fullName",
  "line1",
  "line2",
  "postalCode",
  "city",
  "phone",
] as const satisfies readonly (keyof CheckoutValues)[];

export type CheckoutField = (typeof checkoutFields)[number];

// What a return visit fills in (spec 0007, AC-9); every field empty for a fresh cart.
export type CheckoutPrefill = Record<CheckoutField, string>;

export const emptyPrefill: CheckoutPrefill = {
  email: "",
  fullName: "",
  line1: "",
  line2: "",
  postalCode: "",
  city: "",
  phone: "",
};

export type CheckoutFieldErrors = Partial<Record<CheckoutField, string>>;

// The first message per field, in the shape the form maps onto setError.
export function checkoutFieldErrors(error: z.ZodError): CheckoutFieldErrors {
  const fields: CheckoutFieldErrors = {};
  for (const issue of error.issues) {
    const field = checkoutFields.find((name) => name === issue.path[0]);
    if (field !== undefined) fields[field] ??= issue.message;
  }
  return fields;
}

// Stripe appends `session_id` to the success URL; anything else is not one of ours.
export const sessionIdSchema = z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/);
