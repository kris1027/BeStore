import { createAdminEventLogger } from "@/lib/logger";

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

export const logCategoryEvent = createAdminEventLogger<CategoryEvents>();
