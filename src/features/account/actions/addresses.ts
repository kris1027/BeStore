"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { addressFields } from "@/lib/customer/address-rules";
import {
  deleteSavedAddress,
  saveAddress,
  setDefaultAddress as makeDefault,
  updateSavedAddress,
} from "@/lib/customer/addresses";
import { lockCustomer } from "@/lib/customer/lock";
import { logAccountEvent } from "@/lib/customer/log";
import { requireCustomer } from "@/lib/customer/session";
import { db, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { fieldErrors } from "@/lib/form-errors";
import type { ActionResult } from "@/lib/result";
import { shippingAddressSchema } from "@/lib/shipping/address";

export type AddressField = "fullName" | "line1" | "line2" | "postalCode" | "city" | "phone";

export type AddressError =
  | {
      readonly code: "validation";
      readonly fields: Partial<Record<AddressField, readonly string[]>>;
    }
  | { readonly code: "limit_reached" }
  | { readonly code: "not_found" };

type Result = ActionResult<null, AddressError>;

const idSchema = z.uuid();

// Every write runs under the customer lock (AC-14), for the signed in customer only.
async function underLock<T>(customerId: string, write: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await lockCustomer(tx, customerId);
    return write(tx);
  });
}

function parseAddress(values: unknown) {
  const parsed = shippingAddressSchema(env.STORE_COUNTRY).safeParse(values);
  return parsed.success
    ? ({ ok: true, fields: addressFields(parsed.data, env.STORE_COUNTRY) } as const)
    : ({
        ok: false,
        error: { code: "validation", fields: fieldErrors<AddressField>(parsed.error) },
      } as const);
}

function done(): Result {
  refresh();
  return { ok: true, data: null };
}

// spec 0012, AC-14: the same fields and rules as checkout (spec 0007); the country is the store's.
export async function createAddress(values: unknown): Promise<Result> {
  const customer = await requireCustomer();
  const parsed = parseAddress(values);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const outcome = await underLock(customer.id, (tx) => saveAddress(tx, customer.id, parsed.fields));
  if (outcome.kind === "limit_reached") return { ok: false, error: { code: "limit_reached" } };
  if (outcome.kind === "saved")
    logAccountEvent("account.address_saved", { customerId: customer.id });
  return done();
}

export async function updateAddress(id: unknown, values: unknown): Promise<Result> {
  const customer = await requireCustomer();
  const addressId = idSchema.safeParse(id);
  if (!addressId.success) return { ok: false, error: { code: "not_found" } };
  const parsed = parseAddress(values);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const updated = await underLock(customer.id, (tx) =>
    updateSavedAddress(tx, customer.id, addressId.data, parsed.fields),
  );
  if (!updated) return { ok: false, error: { code: "not_found" } };
  logAccountEvent("account.address_saved", { customerId: customer.id });
  return done();
}

export async function deleteAddress(id: unknown): Promise<Result> {
  const customer = await requireCustomer();
  const addressId = idSchema.safeParse(id);
  if (!addressId.success) return { ok: false, error: { code: "not_found" } };
  const deleted = await underLock(customer.id, (tx) =>
    deleteSavedAddress(tx, customer.id, addressId.data),
  );
  return deleted ? done() : { ok: false, error: { code: "not_found" } };
}

export async function setDefaultAddress(id: unknown): Promise<Result> {
  const customer = await requireCustomer();
  const addressId = idSchema.safeParse(id);
  if (!addressId.success) return { ok: false, error: { code: "not_found" } };
  const set = await underLock(customer.id, (tx) => makeDefault(tx, customer.id, addressId.data));
  return set ? done() : { ok: false, error: { code: "not_found" } };
}
