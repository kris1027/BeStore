import { createAdminEventLogger } from "@/lib/logger";

// spec 0014, AC-18: the admin id, the code id and, on an update, the names of the fields that
// changed. Never the code's text, its note or any order email. The key is `discountCodeId`,
// never `code`, which the logger redacts.

type DiscountEvents = {
  "discount.created": { readonly discountCodeId: string };
  "discount.updated": { readonly discountCodeId: string; readonly changed: readonly string[] };
  "discount.deleted": { readonly discountCodeId: string };
};

export const logDiscountEvent = createAdminEventLogger<DiscountEvents>();
