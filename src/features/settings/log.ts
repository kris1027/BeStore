import { logger } from "@/lib/logger";
import type { ShippingSettings } from "@/lib/shipping/rule";

// spec 0007, AC-14 and Observability: who changed the delivery pricing, from what, to what.
export function logShippingSettingsUpdated(fields: {
  readonly adminId: string;
  readonly from: ShippingSettings;
  readonly to: ShippingSettings;
}) {
  logger.info({ event: "settings.shipping_updated", ...fields }, "settings.shipping_updated");
}
