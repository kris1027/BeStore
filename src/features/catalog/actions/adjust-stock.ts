"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db, type Tx } from "@/lib/db";
import type { ActionResult } from "@/lib/result";
import { recordMovements } from "@/lib/stock-movements";

import { logCatalogEvent } from "../log";
import { pathErrors, stockSchema } from "../schemas";
import { type MovedRow, movedRows, type StockChange, stockChanges } from "../stock";

export type AdjustStockError =
  | { readonly code: "validation"; readonly fields: Record<string, readonly string[]> }
  | { readonly code: "moved"; readonly rows: readonly MovedRow[] }
  | { readonly code: "not_found" };

// spec 0009, AC-10 and AC-11: sets each changed row to the counted number, but only while it
// still holds the count the page showed. The rows are locked in id order (as the paid order
// transition locks them), compared, and all saved with their movements, or none is.
export async function adjustStock(input: unknown): Promise<ActionResult<null, AdjustStockError>> {
  const admin = await requireAdmin();

  const parsed = stockSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", fields: pathErrors(parsed.error) } };
  }
  const { productId } = parsed.data;
  const changes = stockChanges(parsed.data.rows);

  const outcome = await db.$transaction(
    async (tx): Promise<{ readonly slug: string } | AdjustStockError> => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { slug: true },
      });
      if (!product) return { code: "not_found" };
      if (changes.length === 0) return { slug: product.slug };

      const ids = changes.map((change) => change.variantId);
      const locked = await tx.$queryRaw<
        { id: string; stock_quantity: number; archived: boolean }[]
      >`
        SELECT id, stock_quantity, archived FROM product_variants
        WHERE product_id = ${productId}::uuid AND id = ANY(${ids}::uuid[])
        ORDER BY id FOR UPDATE`;
      const moved = movedRows(
        changes,
        locked.map((row) => ({
          id: row.id,
          stockQuantity: row.stock_quantity,
          archived: row.archived,
        })),
      );
      if (moved.length > 0) return { code: "moved", rows: moved };

      for (const change of changes) await setStock(tx, change);
      await recordMovements(
        tx,
        changes.map((change) => ({
          kind: "adjustment",
          variantId: change.variantId,
          delta: change.next - change.expected,
          stockAfter: change.next,
          adminId: admin.id,
          note: change.note,
        })),
      );
      return { slug: product.slug };
    },
  );
  if ("code" in outcome) return { ok: false, error: outcome };
  if (changes.length === 0) return { ok: true, data: null };

  // Stock decides "Sold out" on the grid and the product page.
  updateTag(catalogTag);
  updateTag(productTag(outcome.slug));
  for (const change of changes) {
    logCatalogEvent("catalog.stock.adjusted", {
      adminId: admin.id,
      productId,
      variantId: change.variantId,
      before: change.expected,
      after: change.next,
    });
  }
  return { ok: true, data: null };
}

// The row is locked and was just compared, so the guard always matches; it stays as the compare
// and set the spec names, should the lock above ever change.
async function setStock(tx: Tx, change: StockChange) {
  const updated = await tx.$executeRaw`
    UPDATE product_variants SET stock_quantity = ${change.next}, updated_at = now()
    WHERE id = ${change.variantId}::uuid AND stock_quantity = ${change.expected}
      AND archived = false`;
  if (updated !== 1) throw new Error(`Variant ${change.variantId} moved under its row lock`);
}
