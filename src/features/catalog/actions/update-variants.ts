"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db, type Tx } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import { env } from "@/lib/env";
import type { ActionResult } from "@/lib/result";

import { logCatalogEvent } from "../log";
import { pathErrors, variantsSchema, type VariantsValues } from "../schemas";
import {
  editedRows,
  liveVariantCountAfter,
  type NameEdit,
  renameVerdict,
  type VariantFields,
  variantsStale,
} from "../variant-edit";

type Fields = Record<string, readonly string[]>;

export type UpdateVariantsError =
  | { readonly code: "validation"; readonly fields: Fields }
  | { readonly code: "sku_taken"; readonly fields: Fields }
  | { readonly code: "last_variant" }
  | { readonly code: "rename_swap" }
  | { readonly code: "stale" }
  | { readonly code: "not_found" };

const skuTakenMessage = "Another variant already uses this SKU.";

// spec 0009, AC-7, AC-9 and AC-21: prices, compare at prices, SKUs, archive flags and option
// renames, in one transaction. The product row lock serializes this with publishing and adding
// a value; conflicts compare only the fields this section edits, so a sale in between (which
// changes stock alone) never refuses a price edit.
export async function updateVariants(
  input: unknown,
): Promise<ActionResult<null, UpdateVariantsError>> {
  const admin = await requireAdmin();

  const parsed = variantsSchema(env.STORE_CURRENCY).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", fields: pathErrors(parsed.error) } };
  }
  const values = parsed.data;

  let outcome: { readonly slug: string; readonly changed: boolean } | UpdateVariantsError;
  try {
    outcome = await db.$transaction((tx) => save(tx, values));
  } catch (error) {
    // Another save took a SKU or a name between the checks and the write.
    if (uniqueViolation(error) === null) throw error;
    outcome = { code: "stale" };
  }
  if ("code" in outcome) return { ok: false, error: outcome };
  if (!outcome.changed) return { ok: true, data: null };

  updateTag(catalogTag);
  updateTag(productTag(outcome.slug));
  logCatalogEvent("catalog.product.updated", {
    adminId: admin.id,
    productId: values.productId,
    section: "variants",
  });
  return { ok: true, data: null };
}

async function save(
  tx: Tx,
  values: VariantsValues,
): Promise<{ readonly slug: string; readonly changed: boolean } | UpdateVariantsError> {
  const { productId } = values;
  const [product] = await tx.$queryRaw<{ status: string; slug: string }[]>`
    SELECT status, slug FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
  if (!product) return { code: "not_found" };

  const [variants, optionTypes] = await Promise.all([
    tx.productVariant.findMany({
      where: { productId },
      select: { id: true, priceCents: true, compareAtPriceCents: true, sku: true, archived: true },
    }),
    tx.productOptionType.findMany({
      where: { productId },
      select: { id: true, name: true, values: { select: { id: true, value: true } } },
    }),
  ]);
  const current = new Map<string, VariantFields>(
    variants.map((variant) => [
      variant.id,
      {
        price: variant.priceCents,
        compareAt: variant.compareAtPriceCents,
        sku: variant.sku,
        archived: variant.archived,
      },
    ]),
  );

  // A row or option this product does not have means the page is out of date.
  const rowsKnown = values.rows.every((row) => current.has(row.variantId));
  const typesById = new Map(optionTypes.map((type) => [type.id, type]));
  const namesKnown = values.optionNames.every((type) => {
    const stored = typesById.get(type.typeId);
    return (
      stored !== undefined &&
      type.values.every((value) => stored.values.some((entry) => entry.id === value.valueId))
    );
  });
  if (!rowsKnown || !namesKnown) return { code: "stale" };

  const edited = editedRows(values.rows);
  if (variantsStale(edited, current)) return { code: "stale" };

  const typeEdits: NameEdit[] = values.optionNames.map((type) => ({
    id: type.typeId,
    loaded: type.loadedName,
    next: type.name,
  }));
  const verdicts = [
    renameVerdict(typeEdits, new Map(optionTypes.map((type) => [type.id, type.name]))),
    ...values.optionNames.map((type) =>
      renameVerdict(
        type.values.map((value) => ({
          id: value.valueId,
          loaded: value.loadedValue,
          next: value.value,
        })),
        new Map((typesById.get(type.typeId)?.values ?? []).map((v) => [v.id, v.value])),
      ),
    ),
  ];
  if (verdicts.includes("stale")) return { code: "stale" };
  if (verdicts.includes("swap")) return { code: "rename_swap" };

  if (product.status === "active" && liveVariantCountAfter(current, edited) === 0) {
    return { code: "last_variant" };
  }

  const taken = await takenSkus(tx, values);
  if (taken) return { code: "sku_taken", fields: taken };

  for (const row of edited) {
    await tx.productVariant.update({
      where: { id: row.variantId },
      data: {
        priceCents: row.price,
        compareAtPriceCents: row.compareAt,
        sku: row.sku,
        archived: row.archived,
      },
      select: { id: true },
    });
  }
  const renamedTypes = values.optionNames.filter((type) => type.name !== type.loadedName);
  for (const type of renamedTypes) {
    await tx.productOptionType.update({ where: { id: type.typeId }, data: { name: type.name } });
  }
  const renamedValues = values.optionNames.flatMap((type) =>
    type.values.filter((value) => value.value !== value.loadedValue),
  );
  for (const value of renamedValues) {
    await tx.productOptionValue.update({
      where: { id: value.valueId },
      data: { value: value.value },
    });
  }

  return {
    slug: product.slug,
    changed: edited.length + renamedTypes.length + renamedValues.length > 0,
  };
}

// A changed SKU that any other variant, of any product, holds now. Swapping two SKUs in one save
// is refused this way too, since the unique index would trip halfway through.
async function takenSkus(tx: Tx, values: VariantsValues): Promise<Fields | null> {
  const changed = values.rows.flatMap((row, index) =>
    row.sku === row.loaded.sku ? [] : [{ index, variantId: row.variantId, sku: row.sku }],
  );
  if (changed.length === 0) return null;
  const holders = await tx.productVariant.findMany({
    where: { sku: { in: changed.map((row) => row.sku) } },
    select: { id: true, sku: true },
  });
  const fields: Record<string, readonly string[]> = {};
  for (const row of changed) {
    if (holders.some((holder) => holder.sku === row.sku && holder.id !== row.variantId)) {
      fields[`rows.${row.index}.sku`] = [skuTakenMessage];
    }
  }
  return Object.keys(fields).length > 0 ? fields : null;
}
