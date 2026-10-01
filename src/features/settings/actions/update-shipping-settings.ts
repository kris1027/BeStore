"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { storeSettingsTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { ActionResult } from "@/lib/result";
import type { ShippingSettings } from "@/lib/shipping/rule";

import { logShippingSettingsUpdated } from "../log";
import {
  type ShippingSettingsFieldErrors,
  shippingSettingsFieldErrors,
  shippingSettingsSchema,
} from "../schemas";

export type UpdateShippingSettingsError = {
  readonly code: "validation";
  readonly fields: ShippingSettingsFieldErrors;
};

// spec 0007, AC-10 and AC-14: last write wins on the one row (a few trusted admins, one small
// form). The old row is read under a lock in the same transaction, so the log's "from" is the
// value this save really replaced.
export async function updateShippingSettings(
  input: unknown,
): Promise<ActionResult<null, UpdateShippingSettingsError>> {
  const admin = await requireAdmin();

  const parsed = shippingSettingsSchema(env.STORE_CURRENCY).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "validation", fields: shippingSettingsFieldErrors(parsed.error) },
    };
  }
  const to = parsed.data;

  const from = await db.$transaction(async (tx): Promise<ShippingSettings> => {
    const [row] = await tx.$queryRaw<
      { flat_shipping_cents: number; free_shipping_threshold_cents: number | null }[]
    >`SELECT flat_shipping_cents, free_shipping_threshold_cents
      FROM store_settings WHERE id = 1 FOR UPDATE`;
    // The migration inserts the one row; without it the store cannot price delivery at all.
    if (!row) throw new Error("store_settings row 1 is missing");
    await tx.storeSettings.update({ where: { id: 1 }, data: to, select: { id: true } });
    return {
      flatShippingCents: row.flat_shipping_cents,
      freeShippingThresholdCents: row.free_shipping_threshold_cents,
    };
  });

  // Only after the commit: the next cart and checkout render reads the new values.
  updateTag(storeSettingsTag);
  logShippingSettingsUpdated({ adminId: admin.id, from, to });
  return { ok: true, data: null };
}
