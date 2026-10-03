"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import type { ActionResult } from "@/lib/result";

import { logCategoryEvent } from "../log";
import { categoryFieldErrors, updateCategorySchema } from "../schemas";
import type { CategoryFormError } from "./create-category";

// spec 0009, AC-17 and AC-21: saves the category unless it changed since the page loaded it.
// Reordering rewrites position in raw SQL, so it never bumps updated_at and never refuses this.
export async function updateCategory(
  input: unknown,
): Promise<ActionResult<null, CategoryFormError>> {
  const admin = await requireAdmin();

  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", fields: categoryFieldErrors(parsed.error) } };
  }
  const { categoryId, loadedUpdatedAt, ...fields } = parsed.data;

  let outcome: "saved" | "stale" | "not_found";
  try {
    outcome = await db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ updated_at: Date }[]>`
        SELECT updated_at FROM categories WHERE id = ${categoryId}::uuid FOR UPDATE`;
      if (!row) return "not_found";
      if (row.updated_at.getTime() !== loadedUpdatedAt.getTime()) return "stale";
      await tx.category.update({ where: { id: categoryId }, data: fields, select: { id: true } });
      return "saved";
    });
  } catch (error) {
    if (uniqueViolation(error) === null) throw error;
    return { ok: false, error: { code: "slug_taken" } };
  }
  if (outcome !== "saved") return { ok: false, error: { code: outcome } };

  logCategoryEvent("catalog.category.updated", { adminId: admin.id, categoryId });
  return { ok: true, data: null };
}
