import { z } from "zod";

import { parseCalendarDay } from "@/lib/dates";
import { normalizeEmail } from "@/lib/discounts/schema";
import { shippingAddressSchema, type StoreCountry } from "@/lib/shipping/address";

// Shared by the checkout form (zodResolver) and startCheckout, so both refuse the same input.

export const checkoutMessages = {
  emailInvalid: "Enter a valid email address.",
  // spec 0017, AC-8 and AC-9.
  acceptTerms: "Tick the box to accept the terms of sale.",
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
    // spec 0017, AC-8 and AC-9: unticked (the form's undefined), false or missing all refuse.
    acceptTerms: z.literal(true, { error: checkoutMessages.acceptTerms }),
  });
}

// spec 0017, AC-9: the terms version the page showed, held in component state, never a field the
// customer edits. startCheckout parses it on its own, before any database work.
export const termsVersionSchema = z
  .string()
  .refine((value) => parseCalendarDay(value) !== null, { error: "Not a YYYY-MM-DD date" });

export const startCheckoutInputSchema = z.object({ termsVersion: termsVersionSchema });

export type CheckoutValues = z.input<ReturnType<typeof checkoutSchema>>;
export type CheckoutInput = z.output<ReturnType<typeof checkoutSchema>>;

// The typed fields, which a return visit can fill in.
const checkoutTextFields = [
  "email",
  "fullName",
  "line1",
  "line2",
  "postalCode",
  "city",
  "phone",
] as const satisfies readonly (keyof CheckoutValues)[];

// Every field a validation refusal can name, in the order the form shows them, so the first
// invalid one gets focus.
export const checkoutFields = [
  ...checkoutTextFields,
  "acceptTerms",
] as const satisfies readonly (keyof CheckoutValues)[];

export type CheckoutField = (typeof checkoutFields)[number];

// What a return visit fills in (spec 0007, AC-9); every field empty for a fresh cart.
export type CheckoutPrefill = Record<(typeof checkoutTextFields)[number], string>;

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
