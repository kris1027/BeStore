"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/result";
import { sameIdSet } from "@/lib/sortable";

import { logCategoryEvent } from "../log";
import { reorderCategoriesSchema } from "../schemas";

// spec 0009, AC-20: the full ordered list, refused unless it is exactly the current set of
// categories; positions become 0..n-1 in one statement, without touching updated_at.
export async function reorderCategories(
  input: unknown,
): Promise<ActionResult<null, { readonly code: "stale" }>> {
  const admin = await requireAdmin();

  const parsed = reorderCategoriesSchema.safeParse(input);
  // Only the arrange list calls this, so a malformed request is treated as a stale order.
  if (!parsed.success) return { ok: false, error: { code: "stale" } };
  const { orderedIds } = parsed.data;

  const saved = await db.$transaction(async (tx) => {
    // Holds off a create or delete until this rewrite lands.
    await tx.$executeRaw`LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE`;
    const current = await tx.category.findMany({ select: { id: true } });
    if (
      !sameIdSet(
        orderedIds,
        current.map((row) => row.id),
      )
    )
      return false;
    await tx.$executeRaw`
      UPDATE categories c SET position = v.ord - 1
      FROM unnest(${orderedIds}::uuid[]) WITH ORDINALITY AS v(id, ord)
      WHERE c.id = v.id`;
    return true;
  });
  if (!saved) return { ok: false, error: { code: "stale" } };

  logCategoryEvent("catalog.categories.reordered", { adminId: admin.id, count: orderedIds.length });
  return { ok: true, data: null };
}
