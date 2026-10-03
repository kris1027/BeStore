"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db, type Tx } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import {
  deleteUnreferencedImageFiles,
  imageDuplicateMessage,
  imageMissingMessage,
  missingUploads,
} from "@/lib/product-image-files";
import type { ActionResult } from "@/lib/result";

import { imagesStale } from "../image-edit";
import { logCatalogEvent } from "../log";
import { imagesSchema, type ImagesValues, pathErrors } from "../schemas";

type Fields = Record<string, readonly string[]>;

export type UpdateImagesError =
  | { readonly code: "validation"; readonly fields: Fields }
  | { readonly code: "stale" }
  | { readonly code: "not_found" };

const foreignValueMessage = "Choose a value this product has.";

// spec 0009, AC-13, AC-14 and AC-21: replaces the product's images with the list sent, in its
// order. Removed rows go in the transaction; their files go only after it commits, and only when
// no order line still shows them.
export async function updateProductImages(
  input: unknown,
): Promise<ActionResult<null, UpdateImagesError>> {
  const admin = await requireAdmin();

  const parsed = imagesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", fields: pathErrors(parsed.error) } };
  }
  const values = parsed.data;

  // Before the transaction: Storage and Postgres share no rollback.
  const fresh = values.images.flatMap((image, index) =>
    image.path === undefined ? [] : [{ index, path: image.path }],
  );
  const missing = await missingUploads(fresh.map((image) => image.path));
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: "validation",
        fields: Object.fromEntries(
          missing.map((at) => [`images.${fresh[at]?.index}`, [imageMissingMessage]]),
        ),
      },
    };
  }

  let outcome:
    { readonly slug: string; readonly removedPaths: readonly string[] } | UpdateImagesError;
  try {
    outcome = await db.$transaction((tx) => save(tx, values));
  } catch (error) {
    // Another save took one of these paths between the check and the insert.
    if (uniqueViolation(error) === null) throw error;
    outcome = { code: "stale" };
  }
  if ("code" in outcome) return { ok: false, error: outcome };

  updateTag(catalogTag);
  updateTag(productTag(outcome.slug));
  logCatalogEvent("catalog.product.updated", {
    adminId: admin.id,
    productId: values.productId,
    section: "images",
  });
  await deleteUnreferencedImageFiles(outcome.removedPaths, {
    adminId: admin.id,
    productId: values.productId,
  });
  return { ok: true, data: null };
}

async function save(
  tx: Tx,
  values: ImagesValues,
): Promise<
  { readonly slug: string; readonly removedPaths: readonly string[] } | UpdateImagesError
> {
  const { productId } = values;
  // Locked so two image saves of one product run one after the other.
  const [product] = await tx.$queryRaw<{ slug: string }[]>`
    SELECT slug FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
  if (!product) return { code: "not_found" };

  const [stored, optionValues] = await Promise.all([
    tx.productImage.findMany({
      where: { productId },
      select: { id: true, altText: true, position: true, optionValueId: true, storagePath: true },
    }),
    tx.productOptionValue.findMany({
      where: { optionType: { productId } },
      select: { id: true },
    }),
  ]);
  if (imagesStale(values.loaded, stored, values.images)) return { code: "stale" };

  const ownValues = new Set(optionValues.map((value) => value.id));
  const fields: Record<string, readonly string[]> = {};
  values.images.forEach((image, index) => {
    if (image.optionValueId !== null && !ownValues.has(image.optionValueId)) {
      fields[`images.${index}.optionValueId`] = [foreignValueMessage];
    }
  });
  const newPaths = values.images.flatMap((image) => (image.path === undefined ? [] : [image.path]));
  const used = new Set(
    (
      await tx.productImage.findMany({
        where: { storagePath: { in: newPaths } },
        select: { storagePath: true },
      })
    ).map((row) => row.storagePath),
  );
  values.images.forEach((image, index) => {
    if (image.path !== undefined && used.has(image.path)) {
      fields[`images.${index}`] = [imageDuplicateMessage];
    }
  });
  if (Object.keys(fields).length > 0) return { code: "validation", fields };

  const keptIds = new Set(values.images.flatMap((image) => (image.id ? [image.id] : [])));
  const removed = stored.filter((image) => !keptIds.has(image.id));
  if (removed.length > 0) {
    await tx.productImage.deleteMany({ where: { id: { in: removed.map((image) => image.id) } } });
  }
  for (const [position, image] of values.images.entries()) {
    if (image.id !== undefined) {
      await tx.productImage.update({
        where: { id: image.id },
        data: { altText: image.altText, position, optionValueId: image.optionValueId },
        select: { id: true },
      });
    } else if (image.path !== undefined) {
      await tx.productImage.create({
        data: {
          productId,
          storagePath: image.path,
          altText: image.altText,
          width: image.width ?? null,
          height: image.height ?? null,
          position,
          optionValueId: image.optionValueId,
        },
        select: { id: true },
      });
    }
  }

  return { slug: product.slug, removedPaths: removed.map((image) => image.storagePath) };
}
