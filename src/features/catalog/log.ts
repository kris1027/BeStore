import { logger } from "@/lib/logger";

import type { ProductStatus } from "./status";

// spec 0005, AC-18 and spec 0009, AC-24: the admin id and ids involved, never product content,
// stock notes, image alt text or customer data.

export type ProductSection = "details" | "variants" | "options" | "images" | "categories";

type CatalogEvents = {
  "catalog.product.created": { readonly productId: string; readonly status: string };
  "catalog.product.updated": { readonly productId: string; readonly section: ProductSection };
  "catalog.product.status_changed": {
    readonly productId: string;
    readonly from: ProductStatus;
    readonly to: ProductStatus;
  };
  "catalog.product.deleted": { readonly productId: string };
  "catalog.stock.adjusted": {
    readonly productId: string;
    readonly variantId: string;
    readonly before: number;
    readonly after: number;
  };
  "catalog.products.reordered": { readonly count: number };
};

export function logCatalogEvent<E extends keyof CatalogEvents>(
  event: E,
  fields: { readonly adminId: string } & CatalogEvents[E],
) {
  // Widened to a plain record: pino's message overloads cannot resolve a generic object type.
  const entry: Record<string, unknown> = { event, ...fields };
  logger.info(entry, event);
}
