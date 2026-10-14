import {
  shippingAddressSchema,
  type ShippingAddress,
  type StoreCountry,
} from "@/lib/shipping/address";

// Pure: the address book rules (spec 0012, AC-14 and AC-15), shared by the address book and
// checkout.

export const MAX_SAVED_ADDRESSES = 10;

export type SavedAddressFields = {
  readonly fullName: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly postalCode: string;
  readonly city: string;
  readonly phone: string | null;
  readonly countryCode: string;
};

// Trimmed, with an empty line2 or phone as null, so a saved row and a typed address compare
// field by field.
export function normalizeAddress(fields: SavedAddressFields): SavedAddressFields {
  const optional = (value: string | null) => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    fullName: fields.fullName.trim(),
    line1: fields.line1.trim(),
    line2: optional(fields.line2),
    postalCode: fields.postalCode.trim(),
    city: fields.city.trim(),
    phone: optional(fields.phone),
    countryCode: fields.countryCode.trim(),
  };
}

const compared = [
  "fullName",
  "line1",
  "line2",
  "postalCode",
  "city",
  "phone",
  "countryCode",
] as const;

export function sameAddress(a: SavedAddressFields, b: SavedAddressFields): boolean {
  const left = normalizeAddress(a);
  const right = normalizeAddress(b);
  return compared.every((key) => left[key] === right[key]);
}

export function addressFields(address: ShippingAddress, country: StoreCountry): SavedAddressFields {
  return normalizeAddress({ ...address, countryCode: country });
}

// AC-14: a saved address the current rules refuse (a changed postal rule, another country) shows
// "Check this address" and is never used by checkout until it is edited.
export function addressNeedsCheck(fields: SavedAddressFields, country: StoreCountry): boolean {
  if (fields.countryCode !== country) return true;
  const parsed = shippingAddressSchema(country).safeParse(fields);
  return !parsed.success || !sameAddress(addressFields(parsed.data, country), fields);
}
