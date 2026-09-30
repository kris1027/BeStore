import { z } from "zod";

// Pure: the delivery address rules, shared by the checkout form (zodResolver) and startCheckout
// (spec 0007, AC-2). Every transform is safe to run twice: handleSubmit hands the parsed output
// to the server, which parses it again.

// The countries the store can ship to. STORE_COUNTRY (src/lib/env.ts) accepts only these, so a
// country without a postal rule fails at boot instead of accepting any postal code.
export const storeCountries = ["PL"] as const;

export type StoreCountry = (typeof storeCountries)[number];

type PostalRule = {
  // ASCII digits only: \d would also match other digit scripts.
  readonly pattern: RegExp;
  readonly normalize: (text: string) => string;
  readonly example: string;
};

const postalRules: Record<StoreCountry, PostalRule> = {
  PL: {
    pattern: /^[0-9]{2}-?[0-9]{3}$/,
    normalize: (text) => {
      const digits = text.replace("-", "");
      return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    },
    example: "00-950",
  },
};

// The stored form of a postal code (PL: NN-NNN), or null when it does not match the rule.
export function normalizePostalCode(country: StoreCountry, text: string): string | null {
  const rule = postalRules[country];
  const trimmed = text.trim();
  return rule.pattern.test(trimmed) ? rule.normalize(trimmed) : null;
}

export const addressMessages = {
  fullNameEmpty: "Enter your full name.",
  fullNameLong: "Keep your name under 100 characters.",
  line1Empty: "Enter your street address.",
  lineLong: "Keep this line under 100 characters.",
  cityEmpty: "Enter your city.",
  cityLong: "Keep the city under 60 characters.",
  phone: "Enter a phone number with 7 to 15 digits, or leave it empty.",
} as const;

export function postalCodeMessage(country: StoreCountry): string {
  return `Enter a postal code like ${postalRules[country].example}.`;
}

const PHONE_PATTERN = /^\+?[0-9 ()-]+$/;

function isPhone(text: string): boolean {
  const digits = text.replace(/[^0-9]/g, "").length;
  return PHONE_PATTERN.test(text) && digits >= 7 && digits <= 15;
}

function required(empty: string, max: number, long: string) {
  return z.string().trim().min(1, empty).max(max, long);
}

// Empty after trimming is null; null and undefined come in when the server parses output.
function optionalText() {
  return z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = (value ?? "").trim();
      return trimmed === "" ? null : trimmed;
    });
}

export function shippingAddressSchema(country: StoreCountry) {
  const postalMessage = postalCodeMessage(country);
  return z.object({
    fullName: required(addressMessages.fullNameEmpty, 100, addressMessages.fullNameLong),
    line1: required(addressMessages.line1Empty, 100, addressMessages.lineLong),
    line2: optionalText().pipe(z.string().max(100, addressMessages.lineLong).nullable()),
    postalCode: z.string().transform((text, ctx) => {
      const normalized = normalizePostalCode(country, text);
      if (normalized === null) {
        ctx.addIssue({ code: "custom", message: postalMessage });
        return z.NEVER;
      }
      return normalized;
    }),
    city: required(addressMessages.cityEmpty, 60, addressMessages.cityLong),
    phone: optionalText().pipe(z.string().refine(isPhone, addressMessages.phone).nullable()),
  });
}

export type ShippingAddress = z.output<ReturnType<typeof shippingAddressSchema>>;

// "Poland" for PL in English, "Polska" in Polish; the code itself if Intl has no name for it.
export function countryDisplayName(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
}
