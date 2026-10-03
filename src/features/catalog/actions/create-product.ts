"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import { env } from "@/lib/env";
import {
  imageDuplicateMessage,
  imageMissingMessage,
  missingUploads,
} from "@/lib/product-image-files";
import type { ActionResult } from "@/lib/result";
import { type MovementRow, recordMovements } from "@/lib/stock-movements";

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

// The field errors for a slug, SKUs or image paths already in use, or null when all are free.
async function takenErrors(
  product: ProductFormValues,
): Promise<Record<string, readonly string[]> | null> {
  const [slugTaken, skuRows, imageRows] = await Promise.all([
    db.product.findUnique({ where: { slug: product.slug }, select: { id: true } }),
    db.productVariant.findMany({
      where: { sku: { in: product.variants.map((variant) => variant.sku) } },
      select: { sku: true },
    }),
    db.productImage.findMany({
      where: { storagePath: { in: product.images.map((image) => image.path) } },
      select: { storagePath: true },
    }),
  ]);
  const usedPaths = new Set(imageRows.map((row) => row.storagePath));
  const takenSkus = new Set(skuRows.map((row) => row.sku));
  const fields: Record<string, readonly string[]> = {};
  if (slugTaken) fields.slug = [takenMessages.slug];
  product.variants.forEach((variant, v) => {
    if (takenSkus.has(variant.sku)) fields[`variants.${v}.sku`] = [takenMessages.sku];
  });
  product.images.forEach((image, index) => {
    if (usedPaths.has(image.path)) fields[`images.${index}`] = [imageDuplicateMessage];
  });
  return Object.keys(fields).length > 0 ? fields : null;
}

async function insertProduct(
  product: ProductFormValues,
  status: NewProductStatus,
  adminId: string,
) {
  return db.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: product.name,
        slug: product.slug,
        description: product.description,
        featured: product.featured,
        weightGrams: product.weightGrams,
        status,
      },
      select: { id: true },
    });

    const openings: MovementRow[] = [];
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
      valueIds.push(new Map(row.values.map((value) => [value.value.toLowerCase(), value.id])));
    }

    for (const [position, variant] of product.variants.entries()) {
      const ids = variant.values.map((value, t) => {
        const id = valueIds[t]?.get(value.toLowerCase());
        // The schema checked every variant against the option values it was sent with.
        if (id === undefined) throw new Error(`No option value "${value}" for option ${t}`);
        return id;
      });
      const row = await tx.productVariant.create({
        data: {
          productId: created.id,
          sku: variant.sku,
          priceCents: variant.price,
          compareAtPriceCents: variant.compareAt,
          stockQuantity: variant.stock,
          position,
          optionKey: optionKey(ids),
          optionValues: { create: ids.map((optionValueId) => ({ optionValueId })) },
        },
        select: { id: true },
      });
      openings.push({ kind: "initial", variantId: row.id, stockAfter: variant.stock, adminId });
    }
    // spec 0009, AC-11: every history starts from the count the admin typed, even 0.
    await recordMovements(tx, openings);

    if (product.images.length > 0) {
      await tx.productImage.createMany({
        data: product.images.map((image, position) => ({
          productId: created.id,
          storagePath: image.path,
          altText: image.altText,
          width: image.width,
          height: image.height,
          position,
          // The schema checked the value exists; option values are unique per type, case
          // insensitively.
          optionValueId:
            image.optionValue === null
              ? null
              : (valueIds[image.optionValue.typeIndex]?.get(
                  image.optionValue.value.toLowerCase(),
                ) ?? null),
        })),
      });
    }

    return created;
  });
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
  const missing = await missingUploads(product.images.map((image) => image.path));
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        fields: Object.fromEntries(
          missing.map((index) => [`images.${index}`, [imageMissingMessage]]),
        ),
      },
    };
  }

  const taken = await takenErrors(product);
  if (taken) return { ok: false, error: { fields: taken } };

  let created: { readonly id: string };
  try {
    created = await insertProduct(product, parsedStatus.data, admin.id);
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
