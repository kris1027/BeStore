import "server-only";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { centsToInput } from "@/lib/money";
import { readShippingSettings } from "@/lib/shipping/settings";

import type { ShippingSettingsValues } from "./schemas";

// Not cached: the admin always edits the live row. Callers run requireAdmin() first.
export async function getAdminShippingSettings(): Promise<ShippingSettingsValues> {
  const settings = await readShippingSettings(db);
  const threshold = settings.freeShippingThresholdCents;
  return {
    deliveryFee: centsToInput(settings.flatShippingCents, env.STORE_CURRENCY),
    freeDelivery: threshold !== null,
    freeDeliveryFrom: threshold === null ? "" : centsToInput(threshold, env.STORE_CURRENCY),
  };
}
