"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import { env } from "@/lib/env";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/product-image";
import type { ActionResult } from "@/lib/result";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { logCatalogEvent } from "../log";
import {
  type NewProductStatus,
  pathErrors,
  productFormSchema,
  type ProductFormValues,
  productStatusSchema,
} from "../schemas";
import { optionKey } from "../variant-grid";

export type CreateProductError = {
  readonly form?: "unavailable";
  // Dotted paths, e.g. "variants.0.sku".
  readonly fields?: Record<string, readonly string[]>;
};

const takenMessages = {
  slug: "Another product already uses this URL name.",
  sku: "Another product already uses this SKU.",
} as const;

// The field errors for a slug or SKUs that already exist, or null when all are free.
async function takenErrors(
  product: ProductFormValues,
): Promise<Record<string, readonly string[]> | null> {
  const [slugTaken, skuRows] = await Promise.all([
    db.product.findUnique({ where: { slug: product.slug }, select: { id: true } }),
    db.productVariant.findMany({
      where: { sku: { in: product.variants.map((variant) => variant.sku) } },
      select: { sku: true },
    }),
  ]);
  const takenSkus = new Set(skuRows.map((row) => row.sku));
  const fields: Record<string, readonly string[]> = {};
  if (slugTaken) fields.slug = [takenMessages.slug];
  product.variants.forEach((variant, v) => {
    if (takenSkus.has(variant.sku)) fields[`variants.${v}.sku`] = [takenMessages.sku];
  });
  return Object.keys(fields).length > 0 ? fields : null;
}

async function insertProduct(product: ProductFormValues, status: NewProductStatus) {
  return db.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: product.name,
        slug: product.slug,
        description: product.description,
        status,
      },
      select: { id: true },
    });

    // Value text to id, one map per option type, to link each variant to its values.
    const valueIds: Map<string, string>[] = [];
    for (const [position, type] of product.optionTypes.entries()) {
      const row = await tx.productOptionType.create({
        data: {
          productId: created.id,
          name: type.name,
          position,
          values: { create: type.values.map((value, index) => ({ value, position: index })) },
        },
        select: { values: { select: { id: true, value: true } } },
      });
      valueIds.push(new Map(row.values.map((value) => [value.value, value.id])));
    }

    for (const [position, variant] of product.variants.entries()) {
      const ids = variant.values.map((value, t) => {
        const id = valueIds[t]?.get(value);
        // The schema checked every variant against the option values it was sent with.
        if (id === undefined) throw new Error(`No option value "${value}" for option ${t}`);
        return id;
      });
      await tx.productVariant.create({
        data: {
          productId: created.id,
          sku: variant.sku,
          priceCents: variant.price,
          stockQuantity: variant.stock,
          position,
          optionKey: optionKey(ids),
          optionValues: { create: ids.map((optionValueId) => ({ optionValueId })) },
        },
        select: { id: true },
      });
    }

    if (product.image) {
      await tx.productImage.create({
        data: {
          productId: created.id,
          storagePath: product.image.path,
          altText: product.image.altText,
          width: product.image.width,
          height: product.image.height,
          position: 0,
        },
        select: { id: true },
      });
    }

    return created;
  });
}

// The path pattern is checked by the schema; this confirms the upload really happened.
async function imageExists(path: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient()
    .storage.from(PRODUCT_IMAGE_BUCKET)
    .exists(path);
  return !error && data === true;
}

// spec 0005, AC-3 and AC-4: everything in one transaction, or nothing and a field error.
export async function createProduct(
  values: unknown,
  status: unknown,
): Promise<
  ActionResult<{ readonly productId: string; readonly slug: string }, CreateProductError>
> {
  const admin = await requireAdmin();

  const parsedStatus = productStatusSchema.safeParse(status);
  const parsed = productFormSchema(env.STORE_CURRENCY).safeParse(values);
  if (!parsed.success) return { ok: false, error: { fields: pathErrors(parsed.error) } };
  // Only the two buttons send a status, so anything else is a tampered request.
  if (!parsedStatus.success) return { ok: false, error: { form: "unavailable" } };
  const product = parsed.data;

  // Before the transaction: Storage and Postgres share no rollback.
  if (product.image && !(await imageExists(product.image.path))) {
    return {
      ok: false,
      error: { fields: { image: ["The image did not finish uploading. Choose it again."] } },
    };
  }

  const taken = await takenErrors(product);
  if (taken) return { ok: false, error: { fields: taken } };

  let created: { readonly id: string };
  try {
    created = await insertProduct(product, parsedStatus.data);
  } catch (error) {
    // Another admin took the slug or a SKU between the check and the insert.
    if (uniqueViolation(error) === null) throw error;
    const raced = await takenErrors(product);
    return raced
      ? { ok: false, error: { fields: raced } }
      : { ok: false, error: { form: "unavailable" } };
  }

  // Only after the commit: the next storefront request reads the new product.
  updateTag(catalogTag);
  updateTag(productTag(product.slug));
  logCatalogEvent("catalog.product.created", {
    adminId: admin.id,
    productId: created.id,
    status: parsedStatus.data,
  });

  return { ok: true, data: { productId: created.id, slug: product.slug } };
}
