"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import { linkAtEnd } from "@/lib/product-categories";
import type { ActionResult } from "@/lib/result";

import { logCategoryEvent } from "../log";
import { setCategoryProductsSchema } from "../schemas";

export type SetCategoryProductsError =
  { readonly code: "unknown_product" } | { readonly code: "not_found" };

// spec 0009, AC-18 and AC-21: adds products to the end of the category and removes others.
// Adding a product already there, or removing one already gone, does nothing and is no error.
export async function setCategoryProducts(
  input: unknown,
): Promise<ActionResult<null, SetCategoryProductsError>> {
  const admin = await requireAdmin();

  const parsed = setCategoryProductsSchema.safeParse(input);
  // Only the category products editor calls this, so a malformed request is treated as a missing category.
  if (!parsed.success) return { ok: false, error: { code: "not_found" } };
  const { categoryId, add, remove } = parsed.data;

  const outcome = await db.$transaction(
    async (tx): Promise<{ added: number; removed: number } | SetCategoryProductsError> => {
      // Locked so two adds to one category take different positions. Not redundant with the
      // lock linkAtEnd takes again (a no-op in this transaction): this one must come first, so
      // the not_found check holds under the lock (a delete committing later would otherwise
      // surface as a 23503 throw from linkAtEnd), the linked read below is serialized, and a
      // remove-only call still locks. Category row before product key share is the order the
      // updateProductCategories deadlock test relies on.
      const [category] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM categories WHERE id = ${categoryId}::uuid FOR UPDATE`;
      if (!category) return { code: "not_found" };

      const wanted = [...new Set(add)].filter((id) => !remove.includes(id));
      const found = await tx.product.findMany({
        where: { id: { in: wanted } },
        select: { id: true },
      });
      if (found.length !== wanted.length) return { code: "unknown_product" };

      const { count: removed } = await tx.productCategory.deleteMany({
        where: { categoryId, productId: { in: remove } },
      });
      const linked = new Set(
        (
          await tx.productCategory.findMany({
            where: { categoryId, productId: { in: wanted } },
            select: { productId: true },
          })
        ).map((link) => link.productId),
      );
      const fresh = wanted.filter((id) => !linked.has(id));
      await linkAtEnd(
        tx,
        fresh.map((productId) => ({ productId, categoryId })),
      );
      return { added: fresh.length, removed };
    },
  );
  if ("code" in outcome) return { ok: false, error: outcome };

  logCategoryEvent("catalog.category.updated", { adminId: admin.id, categoryId, ...outcome });
  return { ok: true, data: null };
}
