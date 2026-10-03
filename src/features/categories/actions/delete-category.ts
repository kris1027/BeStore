"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/result";

import { logCategoryEvent } from "../log";
import { deleteCategorySchema } from "../schemas";

// spec 0009, AC-19: removes the category and its links (by cascade); the products stay as
// they are.
export async function deleteCategory(
  input: unknown,
): Promise<ActionResult<null, { readonly code: "not_found" }>> {
  const admin = await requireAdmin();

  const parsed = deleteCategorySchema.safeParse(input);
  // Only the delete button calls this, so a malformed request is treated as a missing category.
  if (!parsed.success) return { ok: false, error: { code: "not_found" } };
  const { categoryId } = parsed.data;

  const products = await db.$transaction(async (tx) => {
    const links = await tx.productCategory.count({ where: { categoryId } });
    const { count } = await tx.category.deleteMany({ where: { id: categoryId } });
    return count === 0 ? null : links;
  });
  if (products === null) return { ok: false, error: { code: "not_found" } };

  logCategoryEvent("catalog.category.deleted", { adminId: admin.id, categoryId, products });
  return { ok: true, data: null };
}
