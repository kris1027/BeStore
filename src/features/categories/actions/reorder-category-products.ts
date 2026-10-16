"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { categoriesTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/result";
import { sameIdSet } from "@/lib/sortable";

import { logCategoryEvent } from "../log";
import { reorderCategoryProductsSchema } from "../schemas";

export type ReorderCategoryProductsError =
  { readonly code: "stale" } | { readonly code: "invalid" };

// spec 0013, AC-23: the category's full product list in its new order, which the category
// page's Featured order follows. The category row is locked first (the order setCategoryProducts
// and linkAtEnd take it in), so an add or remove meanwhile either waits or makes this stale.
// Positions become 0..n-1 in one raw statement.
export async function reorderCategoryProducts(
  input: unknown,
): Promise<ActionResult<null, ReorderCategoryProductsError>> {
  const admin = await requireAdmin();

  const parsed = reorderCategoryProductsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid" } };
  const { categoryId, productIds } = parsed.data;

  const saved = await db.$transaction(async (tx) => {
    const [category] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM categories WHERE id = ${categoryId}::uuid FOR UPDATE`;
    if (!category) return false;
    const current = await tx.productCategory.findMany({
      where: { categoryId },
      select: { productId: true },
    });
    if (
      !sameIdSet(
        productIds,
        current.map((link) => link.productId),
      )
    )
      return false;
    await tx.$executeRaw`
      UPDATE product_categories pc SET position = v.ord - 1
      FROM unnest(${productIds}::uuid[]) WITH ORDINALITY AS v(id, ord)
      WHERE pc.category_id = ${categoryId}::uuid AND pc.product_id = v.id`;
    return true;
  });
  if (!saved) return { ok: false, error: { code: "stale" } };

  updateTag(categoriesTag);
  logCategoryEvent("catalog.category.products_reordered", {
    adminId: admin.id,
    categoryId,
    count: productIds.length,
  });
  return { ok: true, data: null };
}
