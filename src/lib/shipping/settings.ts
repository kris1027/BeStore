import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { storeSettingsTag } from "@/lib/cache-tags";
import { db, type Tx } from "@/lib/db";

import type { ShippingSettings } from "./rule";

const select = { flatShippingCents: true, freeShippingThresholdCents: true } as const;

// For display (the cart, the checkout summary). Cached until updateShippingSettings expires the
// tag. The migration inserts the one row, so a missing row is a broken invariant.
export async function getShippingSettings(): Promise<ShippingSettings> {
  "use cache";
  cacheLife("max");
  cacheTag(storeSettingsTag);
  return db.storeSettings.findUniqueOrThrow({ where: { id: 1 }, select });
}

// The live row, never cached. Pay passes its order transaction (spec 0007, AC-5 and AC-7), so the
// fee charged is the one in effect at that moment; the admin settings page reads it as is.
export async function readShippingSettings(client: Tx = db): Promise<ShippingSettings> {
  return client.storeSettings.findUniqueOrThrow({ where: { id: 1 }, select });
}
