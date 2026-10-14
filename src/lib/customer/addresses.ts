import "server-only";

import { db, type Tx } from "@/lib/db";

import {
  MAX_SAVED_ADDRESSES,
  normalizeAddress,
  sameAddress,
  type SavedAddressFields,
} from "./address-rules";

// The address book writes (spec 0012, AC-14 and AC-15). Every function here runs inside a
// transaction that already holds the customer lock (src/lib/customer/lock.ts), so the default
// and the cap of 10 hold under concurrent saves.

const addressColumns = {
  id: true,
  fullName: true,
  line1: true,
  line2: true,
  postalCode: true,
  city: true,
  phone: true,
  countryCode: true,
  isDefault: true,
} as const;

export type SavedAddress = SavedAddressFields & {
  readonly id: string;
  readonly isDefault: boolean;
};

// Default first, then the newest, then id.
const bookOrder = [
  { isDefault: "desc" as const },
  { createdAt: "desc" as const },
  { id: "desc" as const },
];

export function listSavedAddresses(
  customerId: string,
  client: Pick<Tx, "customerAddress"> = db,
): Promise<SavedAddress[]> {
  return client.customerAddress.findMany({
    where: { customerId },
    orderBy: bookOrder,
    select: addressColumns,
  });
}

export type SaveOutcome =
  | { readonly kind: "saved"; readonly id: string }
  | { readonly kind: "existing"; readonly id: string }
  | { readonly kind: "limit_reached" };

// An address equal to a saved one, field by field, adds nothing; at 10 nothing is added either.
// The first address saved becomes the default.
export async function saveAddress(
  tx: Tx,
  customerId: string,
  fields: SavedAddressFields,
): Promise<SaveOutcome> {
  const saved = await listSavedAddresses(customerId, tx);
  const match = saved.find((row) => sameAddress(row, fields));
  if (match) return { kind: "existing", id: match.id };
  if (saved.length >= MAX_SAVED_ADDRESSES) return { kind: "limit_reached" };
  const created = await tx.customerAddress.create({
    data: { customerId, ...normalizeAddress(fields), isDefault: saved.length === 0 },
    select: { id: true },
  });
  return { kind: "saved", id: created.id };
}

export async function updateSavedAddress(
  tx: Tx,
  customerId: string,
  id: string,
  fields: SavedAddressFields,
): Promise<boolean> {
  const { count } = await tx.customerAddress.updateMany({
    where: { id, customerId },
    data: normalizeAddress(fields),
  });
  return count === 1;
}

// Deleting the default makes the newest remaining address the default.
export async function deleteSavedAddress(tx: Tx, customerId: string, id: string): Promise<boolean> {
  const row = await tx.customerAddress.findFirst({
    where: { id, customerId },
    select: { isDefault: true },
  });
  if (!row) return false;
  await tx.customerAddress.delete({ where: { id } });
  if (row.isDefault) {
    const newest = await tx.customerAddress.findFirst({
      where: { customerId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (newest)
      await tx.customerAddress.update({ where: { id: newest.id }, data: { isDefault: true } });
  }
  return true;
}

// The old default is cleared before the new one is set, so the partial unique index (one default
// per customer) never fails.
export async function setDefaultAddress(tx: Tx, customerId: string, id: string): Promise<boolean> {
  const row = await tx.customerAddress.findFirst({
    where: { id, customerId },
    select: { id: true },
  });
  if (!row) return false;
  await tx.customerAddress.updateMany({
    where: { customerId, isDefault: true, NOT: { id } },
    data: { isDefault: false },
  });
  await tx.customerAddress.update({ where: { id }, data: { isDefault: true } });
  return true;
}
