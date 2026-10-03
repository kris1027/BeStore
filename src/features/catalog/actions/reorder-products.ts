"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/result";
import { sameIdSet } from "@/lib/sortable";

import { logCatalogEvent } from "../log";
import { reorderProductsSchema } from "../schemas";

// spec 0009, AC-20 and AC-23: the full ordered list of active products, past the 48 the home
// grid shows too. Refused unless it is exactly the current active set (a publish, hide or delete
// meanwhile changes it); positions become 0..n-1 in one raw statement, so updated_at (the
// Details conflict token) never moves. Active rows are locked, so a publish waits for this.
export async function reorderProducts(
  input: unknown,
): Promise<ActionResult<null, { readonly code: "stale" }>> {
  const admin = await requireAdmin();

  const parsed = reorderProductsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "stale" } };
  const { orderedIds } = parsed.data;

  const saved = await db.$transaction(async (tx) => {
    const current = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products WHERE status = 'active' ORDER BY id FOR UPDATE`;
    if (
      !sameIdSet(
        orderedIds,
        current.map((row) => row.id),
      )
    )
      return false;
    await tx.$executeRaw`
      UPDATE products p SET position = v.ord - 1
      FROM unnest(${orderedIds}::uuid[]) WITH ORDINALITY AS v(id, ord)
      WHERE p.id = v.id`;
    return true;
  });
  if (!saved) return { ok: false, error: { code: "stale" } };

  // Product pages do not show the order, so only the grid's tag expires.
  updateTag(catalogTag);
  logCatalogEvent("catalog.products.reordered", { adminId: admin.id, count: orderedIds.length });
  return { ok: true, data: null };
}
