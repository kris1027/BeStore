import "server-only";

import type { Tx } from "@/lib/db";

// Links products into categories at the end of each (spec 0009, AC-18). Shared by the catalog's
// create and Categories section, so a product joins a category the same way from either side.
// Each category row is locked first, in id order, so two joins never take the same position.
export async function linkAtEnd(
  tx: Tx,
  links: readonly { readonly productId: string; readonly categoryId: string }[],
): Promise<void> {
  const categoryIds = [...new Set(links.map((link) => link.categoryId))].sort();
  if (categoryIds.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM categories WHERE id = ANY(${categoryIds}::uuid[]) ORDER BY id FOR UPDATE`;
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
