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

// The digit count alone leaves separators unbounded, so the whole string is capped too.
const PHONE_MAX_LENGTH = 30;

function isPhone(text: string): boolean {
  const digits = text.replace(/[^0-9]/g, "").length;
  return text.length <= PHONE_MAX_LENGTH && PHONE_PATTERN.test(text) && digits >= 7 && digits <= 15;
}

// Each base z.string() carries the field's message, so a crafted call that omits a field or
// sends another type gets the spec's message, not Zod's default text.
function required(empty: string, max: number, long: string) {
  return z.string({ error: empty }).trim().min(1, empty).max(max, long);
}

// Empty after trimming is null; null and undefined come in when the server parses output.
function optionalText(message: string) {
  return z
    .string({ error: message })
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
    line2: optionalText(addressMessages.lineLong).pipe(
      z.string().max(100, addressMessages.lineLong).nullable(),
    ),
    postalCode: z.string({ error: postalMessage }).transform((text, ctx) => {
      const normalized = normalizePostalCode(country, text);
      if (normalized === null) {
        ctx.addIssue({ code: "custom", message: postalMessage });
        return z.NEVER;
      }
      return normalized;
    }),
    city: required(addressMessages.cityEmpty, 60, addressMessages.cityLong),
    phone: optionalText(addressMessages.phone).pipe(
      z.string().refine(isPhone, addressMessages.phone).nullable(),
    ),
  });
}

export type ShippingAddress = z.output<ReturnType<typeof shippingAddressSchema>>;

// A parsed address and the country it ships to: what Pay saves on the order and sends to Stripe.
export type ShipTo = ShippingAddress & { readonly countryCode: StoreCountry };

// The order columns a ShipTo is saved in (spec 0007, AC-5).
export function deliveryColumns(shipTo: ShipTo) {
  return {
    shipFullName: shipTo.fullName,
    shipLine1: shipTo.line1,
    shipLine2: shipTo.line2,
    shipPostalCode: shipTo.postalCode,
    shipCity: shipTo.city,
    shipCountryCode: shipTo.countryCode,
    phone: shipTo.phone,
  };
}

// "Poland" for PL in English, "Polska" in Polish; the code itself if Intl has no name for it.
export function countryDisplayName(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
}

// An order's stored address, as the order pages show it.
export type DeliveryAddress = {
  readonly fullName: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly postalCode: string;
  readonly city: string;
  readonly countryName: string;
};

// The Prisma select for the order columns deliveryAddress reads.
export const deliveryAddressColumns = {
  shipFullName: true,
  shipLine1: true,
  shipLine2: true,
  shipPostalCode: true,
  shipCity: true,
  shipCountryCode: true,
} as const;

export type DeliveryAddressRow = {
  readonly [K in keyof typeof deliveryAddressColumns]: string | null;
};

// An order row with its ship* columns folded into one `address`, so the raw columns never reach
// the page beside it. address is null for an order made before spec 0007, which has none (AC-11,
// AC-13); line2 is the only column that may be null on an order that has one.
export function withDeliveryAddress<Row extends DeliveryAddressRow>(
  row: Row,
  locale: string,
): Omit<Row, keyof DeliveryAddressRow> & { readonly address: DeliveryAddress | null } {
  const { shipFullName, shipLine1, shipLine2, shipPostalCode, shipCity, shipCountryCode, ...rest } =
    row;
  const address =
    shipFullName !== null &&
    shipLine1 !== null &&
    shipPostalCode !== null &&
    shipCity !== null &&
    shipCountryCode !== null
      ? {
          fullName: shipFullName,
          line1: shipLine1,
          line2: shipLine2,
          postalCode: shipPostalCode,
          city: shipCity,
          countryName: countryDisplayName(shipCountryCode, locale),
        }
      : null;
  return { ...rest, address };
}
