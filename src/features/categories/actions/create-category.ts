"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import type { ActionResult } from "@/lib/result";

import { logCategoryEvent } from "../log";
import { categoryFieldErrors, createCategorySchema } from "../schemas";

export type CategoryFormError =
  | { readonly code: "validation"; readonly fields: Record<string, string> }
  | { readonly code: "slug_taken" }
  | { readonly code: "stale" }
  | { readonly code: "not_found" };

// spec 0009, AC-17: a new category goes last. No cache tag yet: nothing on the storefront reads
// categories until feature 13 (AC-23).
export async function createCategory(
  input: unknown,
): Promise<ActionResult<{ readonly categoryId: string }, CategoryFormError>> {
  const admin = await requireAdmin();

  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", fields: categoryFieldErrors(parsed.error) } };
  }

  let categoryId: string;
  try {
    categoryId = await db.$transaction(async (tx) => {
      // Serializes two creates, so they never share a position.
      await tx.$executeRaw`LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE`;
      const last = await tx.category.aggregate({ _max: { position: true } });
      const created = await tx.category.create({
        data: { ...parsed.data, position: (last._max.position ?? -1) + 1 },
        select: { id: true },
      });
      return created.id;
    });
  } catch (error) {
    if (uniqueViolation(error) === null) throw error;
    return { ok: false, error: { code: "slug_taken" } };
  }

  logCategoryEvent("catalog.category.created", { adminId: admin.id, categoryId });
  return { ok: true, data: { categoryId } };
}
