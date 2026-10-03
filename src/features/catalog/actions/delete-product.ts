"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { deleteUnreferencedImageFiles } from "@/lib/product-image-files";
import type { ActionResult } from "@/lib/result";

import { logCatalogEvent } from "../log";
import { deleteProductSchema } from "../schemas";

export type DeleteProductError =
  { readonly code: "on_order" } | { readonly code: "is_active" } | { readonly code: "not_found" };

// spec 0009, AC-4: deletes a product that is not active and that no order line references,
// with its variants, options, images, category links, stock history and the cart lines holding
// its variants (all by cascade), then its image files once that commits.
//
// The product row, then its variant rows, are locked before the order check. startCheckout
// takes FOR KEY SHARE on the variants it snapshots, so a checkout either finished first (and the
// check, a fresh read, sees its order line) or waits and then finds the variants gone. A product
// is never deleted under a pending order. The product lock is FOR NO KEY UPDATE, not FOR UPDATE:
// a checkout holding the variants still needs a key share on the product for its order line's
// foreign key, and a full lock here would deadlock with it.
export async function deleteProduct(
  input: unknown,
): Promise<ActionResult<null, DeleteProductError>> {
  const admin = await requireAdmin();

  const parsed = deleteProductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "not_found" } };
  const { productId } = parsed.data;

  const outcome = await db.$transaction(
    async (tx): Promise<{ slug: string; paths: string[] } | DeleteProductError> => {
      const [product] = await tx.$queryRaw<{ slug: string; status: string }[]>`
        SELECT slug, status FROM products WHERE id = ${productId}::uuid FOR NO KEY UPDATE`;
      if (!product) return { code: "not_found" };
      // One deliberate step first: hide (or archive) it, then delete.
      if (product.status === "active") return { code: "is_active" };

      await tx.$queryRaw`
        SELECT id FROM product_variants WHERE product_id = ${productId}::uuid
        ORDER BY id FOR UPDATE`;
      // Any order, whatever its status: an expired one blocks delete forever, by design.
      const [onOrder] = await tx.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM order_lines
          WHERE product_id = ${productId}::uuid
             OR variant_id IN (SELECT id FROM product_variants WHERE product_id = ${productId}::uuid)
        ) AS exists`;
      if (onOrder?.exists) return { code: "on_order" };

      const images = await tx.productImage.findMany({
        where: { productId },
        select: { storagePath: true },
      });
      await tx.product.delete({ where: { id: productId }, select: { id: true } });
      return { slug: product.slug, paths: images.map((image) => image.storagePath) };
    },
  );
  if ("code" in outcome) return { ok: false, error: outcome };

  updateTag(catalogTag);
  updateTag(productTag(outcome.slug));
  logCatalogEvent("catalog.product.deleted", { adminId: admin.id, productId });
  await deleteUnreferencedImageFiles(outcome.paths, { adminId: admin.id, productId });
  return { ok: true, data: null };
}
