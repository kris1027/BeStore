import { logger } from "@/lib/logger";

// spec 0009, AC-24: the admin id and ids involved, never names or descriptions.

type CategoryEvents = {
  "catalog.category.created": { readonly categoryId: string };
  "catalog.category.updated": {
    readonly categoryId: string;
    readonly added?: number;
    readonly removed?: number;
  };
  "catalog.category.deleted": { readonly categoryId: string; readonly products: number };
  "catalog.categories.reordered": { readonly count: number };
};

export function logCategoryEvent<E extends keyof CategoryEvents>(
  event: E,
  fields: { readonly adminId: string } & CategoryEvents[E],
) {
  // Widened to a plain record: pino's message overloads cannot resolve a generic object type.
  const entry: Record<string, unknown> = { event, ...fields };
  logger.info(entry, event);
}
