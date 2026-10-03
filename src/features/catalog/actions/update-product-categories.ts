"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import { linkAtEnd, lockCategories } from "@/lib/product-categories";
import type { ActionResult } from "@/lib/result";
import { sameIdSet } from "@/lib/sortable";

import { logCatalogEvent } from "../log";
import { productCategoriesSchema } from "../schemas";

export type UpdateProductCategoriesError =
  | { readonly code: "unknown_category" }
  | { readonly code: "stale" }
  | { readonly code: "not_found" };

// spec 0009, AC-18 and AC-21: sets the product's categories, refused when its stored set
// differs from the one the page loaded. A new category takes the product at its end. Nothing
// is expired: no storefront read uses categories until feature 13 (AC-23).
//
// The product lock is FOR NO KEY UPDATE: the category page locks a category and then links a
// product, whose foreign key needs a key share on the product row, so a full lock here would
// deadlock with it.
export async function updateProductCategories(
  input: unknown,
): Promise<ActionResult<null, UpdateProductCategoriesError>> {
  const admin = await requireAdmin();

  const parsed = productCategoriesSchema.safeParse(input);
  // Only the categories section calls this, so a malformed request is treated as a stale save.
  if (!parsed.success) return { ok: false, error: { code: "stale" } };
  const { productId, loadedCategoryIds, categoryIds } = parsed.data;

  const outcome = await db.$transaction(
    async (tx): Promise<"saved" | UpdateProductCategoriesError> => {
      const [product] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM products WHERE id = ${productId}::uuid FOR NO KEY UPDATE`;
      if (!product) return { code: "not_found" };

      const stored = await tx.productCategory.findMany({
        where: { productId },
        select: { categoryId: true },
      });
      const storedIds = stored.map((link) => link.categoryId);
      if (!sameIdSet(loadedCategoryIds, storedIds)) return { code: "stale" };

      if (!(await lockCategories(tx, categoryIds))) return { code: "unknown_category" };

      const removed = storedIds.filter((id) => !categoryIds.includes(id));
      if (removed.length > 0) {
        await tx.productCategory.deleteMany({ where: { productId, categoryId: { in: removed } } });
      }
      await linkAtEnd(
        tx,
        categoryIds
          .filter((id) => !storedIds.includes(id))
          .map((categoryId) => ({ productId, categoryId })),
      );
      return "saved";
    },
  );
  if (outcome !== "saved") return { ok: false, error: outcome };

  logCatalogEvent("catalog.product.updated", {
    adminId: admin.id,
    productId,
    section: "categories",
  });
  return { ok: true, data: null };
}
