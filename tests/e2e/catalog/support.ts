import { randomUUID } from "node:crypto";

import { withDb } from "../admin/support";

// Catalog rows written straight to the database, for tests about the cart rather than the admin
// form. A fresh slug has never been cached, so its product page renders from these rows.

export type SeededProduct = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly variantId: string;
};

export async function seedProduct(options: { stock: number; priceCents?: number; label?: string }) {
  const suffix = randomUUID().slice(0, 8);
  const name = `${options.label ?? "Wool socks"} ${suffix}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return withDb(async (db): Promise<SeededProduct> => {
    const product = await db.query<{ id: string }>(
      `INSERT INTO products (id, name, slug, status, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'active', now()) RETURNING id`,
      [name, slug],
    );
    const productId = product.rows[0]!.id;
    const variant = await db.query<{ id: string }>(
      `INSERT INTO product_variants
         (id, product_id, sku, price_cents, stock_quantity, position, option_key, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, '', now()) RETURNING id`,
      [productId, `SEED-${suffix.toUpperCase()}`, options.priceCents ?? 1500, options.stock],
    );
    return { id: productId, name, slug, variantId: variant.rows[0]!.id };
  });
}

export async function setStock(variantId: string, stock: number) {
  await withDb((db) =>
    db.query("UPDATE product_variants SET stock_quantity = $2 WHERE id = $1", [variantId, stock]),
  );
}

export async function setProductStatus(productId: string, status: "draft" | "active") {
  await withDb((db) =>
    db.query("UPDATE products SET status = $2 WHERE id = $1", [productId, status]),
  );
}
