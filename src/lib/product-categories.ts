import "server-only";

import type { Tx } from "@/lib/db";

// Locks the categories in id order and answers whether every one still exists. A count read
// before the lock is not enough: a delete committing while this waited leaves the row gone, and
// linking to it would fail on the foreign key. Callers check this before linkAtEnd.
export async function lockCategories(tx: Tx, ids: readonly string[]): Promise<boolean> {
  const categoryIds = [...new Set(ids)].sort();
  if (categoryIds.length === 0) return true;
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM categories WHERE id = ANY(${categoryIds}::uuid[]) ORDER BY id FOR UPDATE`;
  return locked.length === categoryIds.length;
}

// Links products into categories at the end of each (spec 0009, AC-18). Shared by the catalog's
// create and Categories section, so a product joins a category the same way from either side.
// Each category row is locked first, in id order, so two joins never take the same position.
export async function linkAtEnd(
  tx: Tx,
  links: readonly { readonly productId: string; readonly categoryId: string }[],
): Promise<void> {
  const categoryIds = [...new Set(links.map((link) => link.categoryId))].sort();
  if (categoryIds.length === 0) return;
  await lockCategories(tx, categoryIds);
  for (const categoryId of categoryIds) {
    const last = await tx.productCategory.aggregate({
      where: { categoryId },
      _max: { position: true },
    });
    const productIds = links
      .filter((link) => link.categoryId === categoryId)
      .map((link) => link.productId);
    await tx.productCategory.createMany({
      data: productIds.map((productId, index) => ({
        productId,
        categoryId,
        position: (last._max.position ?? -1) + 1 + index,
      })),
      skipDuplicates: true,
    });
  }
}
