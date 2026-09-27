import { logger } from "@/lib/logger";

// spec 0005, AC-18: ids and the status only, never product content or customer data.
export function logCatalogEvent(
  event: "catalog.product.created",
  fields: { readonly adminId: string; readonly productId: string; readonly status: string },
) {
  logger.info({ event, ...fields }, event);
}
