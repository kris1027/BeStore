import { z } from "zod";

import { normalizeEmail } from "@/lib/discounts/schema";
import { shippingAddressSchema, type StoreCountry } from "@/lib/shipping/address";

// Shared by the checkout form (zodResolver) and startCheckout, so both refuse the same input.

export const checkoutMessages = {
  emailInvalid: "Enter a valid email address.",
} as const;

// Lowercasing and trimming twice gives the same email, so the server can parse the form's output.
// The one normaliser the per customer code limit compares by (spec 0014, AC-3).
export const emailSchema = z
  .string({ error: checkoutMessages.emailInvalid })
  .trim()
  .max(254, checkoutMessages.emailInvalid)
  .pipe(z.email(checkoutMessages.emailInvalid))
  .transform(normalizeEmail);

export function checkoutSchema(country: StoreCountry) {
  return z.object({
    email: emailSchema,
    ...shippingAddressSchema(country).shape,
    // spec 0012, AC-15: "Save this address to my account"; only a signed in checkout reads it.
    saveAddress: z.boolean().default(false),
    // spec 0014, AC-4: the applied promo code, checked again by Pay under the code lock. Any
    // value is passed on as typed: one that is not a code is refused as "This code isn't valid."
    discountCode: z.unknown().optional(),
  });
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
