"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db, type Tx } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import { env } from "@/lib/env";
import type { ActionResult } from "@/lib/result";
import { type MovementRow, recordMovements } from "@/lib/stock-movements";

import { logCatalogEvent } from "../log";
import { type AddOptionValueValues, addOptionValueSchema, pathErrors } from "../schemas";
import { newValueCombinations, sameCombinations, withNewValue } from "../variant-edit";
import { MAX_COMBINATIONS, MAX_OPTION_VALUES, optionKey } from "../variant-grid";

type Fields = Record<string, readonly string[]>;

export type AddOptionValueError =
  | { readonly code: "validation"; readonly fields: Fields }
  | { readonly code: "too_many_values" }
  | { readonly code: "too_many_variants" }
  | { readonly code: "sku_taken"; readonly fields: Fields }
  | { readonly code: "stale" }
  | { readonly code: "not_found" };

// spec 0009, AC-8: adds a value to an existing option type, last in its type, with one new
// variant per new combination and each one's opening stock movement. Existing rows keep their
// values and option_key; values are never removed, so every one counts toward the limit.
export async function addOptionValue(
  input: unknown,
): Promise<ActionResult<{ readonly variantIds: readonly string[] }, AddOptionValueError>> {
  const admin = await requireAdmin();

  const parsed = addOptionValueSchema(env.STORE_CURRENCY).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", fields: pathErrors(parsed.error) } };
  }
  const values = parsed.data;

  let outcome:
    { readonly slug: string; readonly variantIds: readonly string[] } | AddOptionValueError;
  try {
    outcome = await db.$transaction((tx) => insert(tx, values, admin.id));
  } catch (error) {
    // Another save took a SKU or the value between the checks and the insert.
    if (uniqueViolation(error) === null) throw error;
    outcome = { code: "stale" };
  }
  if ("code" in outcome) return { ok: false, error: outcome };

  updateTag(catalogTag);
  updateTag(productTag(outcome.slug));
  logCatalogEvent("catalog.product.updated", {
    adminId: admin.id,
    productId: values.productId,
    section: "options",
  });
  return { ok: true, data: { variantIds: outcome.variantIds } };
}

async function insert(
  tx: Tx,
  values: AddOptionValueValues,
  adminId: string,
): Promise<
  { readonly slug: string; readonly variantIds: readonly string[] } | AddOptionValueError
> {
  const { productId, optionTypeId } = values;
  const [product] = await tx.$queryRaw<{ slug: string }[]>`
    SELECT slug FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
  if (!product) return { code: "not_found" };

  const optionTypes = await tx.productOptionType.findMany({
    where: { productId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      values: { orderBy: { position: "asc" }, select: { id: true, value: true, position: true } },
    },
  });
  const typeIndex = optionTypes.findIndex((type) => type.id === optionTypeId);
  const type = optionTypes[typeIndex];
  if (!type) return { code: "stale" };

  if (type.values.some((entry) => entry.value.toLowerCase() === values.value.toLowerCase())) {
    return { code: "validation", fields: { value: ["This value is already there."] } };
  }
  if (type.values.length >= MAX_OPTION_VALUES) return { code: "too_many_values" };

  const needed = newValueCombinations(
    optionTypes.map((entry) => entry.values.map((value) => value.id)),
    typeIndex,
  );
  // The page built its rows from the values it loaded; anything else is out of date.
  if (
    !sameCombinations(
      values.newVariants.map((row) => row.otherValueIds),
      needed,
    )
  ) {
    return { code: "stale" };
  }

  const existing = await tx.productVariant.aggregate({
    where: { productId },
    _count: { _all: true },
    _max: { position: true },
  });
  // Archived variants count too: they keep their rows forever.
  if (existing._count._all + needed.length > MAX_COMBINATIONS) {
    return { code: "too_many_variants" };
  }

  const taken = await takenSkus(tx, values);
  if (taken) return { code: "sku_taken", fields: taken };

  const value = await tx.productOptionValue.create({
    data: {
      optionTypeId,
      value: values.value,
      position: (type.values.at(-1)?.position ?? -1) + 1,
    },
    select: { id: true },
  });

  // In grid order, after every existing variant.
  const rowsByKey = new Map(values.newVariants.map((row) => [row.otherValueIds.join(","), row]));
  const firstPosition = (existing._max.position ?? -1) + 1;
  const variantIds: string[] = [];
  const openings: MovementRow[] = [];
  for (const [offset, others] of needed.entries()) {
    const row = rowsByKey.get(others.join(","));
    // sameCombinations matched every needed combination to a row.
    if (!row) throw new Error("A needed combination has no row");
    const ids = withNewValue(others, typeIndex, value.id);
    const created = await tx.productVariant.create({
      data: {
        productId,
        sku: row.sku,
        priceCents: row.price,
        compareAtPriceCents: row.compareAt,
        stockQuantity: row.stock,
        position: firstPosition + offset,
        optionKey: optionKey(ids),
        optionValues: { create: ids.map((optionValueId) => ({ optionValueId })) },
      },
      select: { id: true },
    });
    variantIds.push(created.id);
    openings.push({ kind: "initial", variantId: created.id, stockAfter: row.stock, adminId });
  }
  await recordMovements(tx, openings);

  return { slug: product.slug, variantIds };
}

async function takenSkus(tx: Tx, values: AddOptionValueValues): Promise<Fields | null> {
  const holders = await tx.productVariant.findMany({
    where: { sku: { in: values.newVariants.map((row) => row.sku) } },
    select: { sku: true },
  });
  const held = new Set(holders.map((holder) => holder.sku));
  const fields: Record<string, readonly string[]> = {};
  values.newVariants.forEach((row, index) => {
    if (held.has(row.sku))
      fields[`newVariants.${index}.sku`] = ["Another variant already uses this SKU."];
  });
  return Object.keys(fields).length > 0 ? fields : null;
}
