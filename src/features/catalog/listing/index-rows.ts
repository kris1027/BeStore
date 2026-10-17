import { facetKey, searchWords } from "@/lib/search-text";

import type { ProductImage } from "../queries";
import type { ListingOptionType, ListingProduct } from "./listing";

// Pure: one product row as the listing index stores it (spec 0013, Data model sketch).

export type IndexRow = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly position: number;
  readonly createdAt: Date;
  readonly image: ProductImage;
  readonly categories: readonly { readonly categoryId: string; readonly position: number }[];
  // In admin position order, values too.
  readonly optionTypes: readonly {
    readonly name: string;
    readonly values: readonly { readonly id: string; readonly value: string }[];
  }[];
  // Non archived only.
  readonly variants: readonly {
    readonly priceCents: number;
    readonly compareAtPriceCents: number | null;
    readonly stockQuantity: number;
    readonly optionValues: readonly { readonly optionValueId: string }[];
  }[];
};

// AC-13: types whose names fold to one key merge into one (the first spelling labels it), and
// values merge by key inside it; a type or value with an empty key is skipped. Labels are kept
// once per product and variants point at them by index, so the cache entry stays small.
// The index of the entry with this key, appending a new one (the first spelling) when absent.
function slotFor<T extends { readonly key: string }>(
  list: T[],
  key: string,
  create: () => T,
): number {
  const found = list.findIndex((entry) => entry.key === key);
  return found >= 0 ? found : list.push(create()) - 1;
}

export function buildIndexProduct(row: IndexRow): ListingProduct {
  const types: { key: string; label: string; values: { key: string; label: string }[] }[] = [];
  // option value id → [type index, value index]
  const place = new Map<string, readonly [number, number]>();
  for (const type of row.optionTypes) {
    const key = facetKey(type.name);
    if (key === "") continue;
    const t = slotFor(types, key, () => ({ key, label: type.name.trim(), values: [] }));
    const merged = types[t];
    if (!merged) continue;
    for (const value of type.values) {
      const valueKey = facetKey(value.value);
      if (valueKey === "") continue;
      const v = slotFor(merged.values, valueKey, () => ({
        key: valueKey,
        label: value.value.trim(),
      }));
      place.set(value.id, [t, v]);
    }
  }

  const optionTypes: readonly ListingOptionType[] = types;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    nameWords: searchWords(row.name),
    position: row.position,
    createdAtMs: row.createdAt.getTime(),
    image: row.image,
    categoryPositions: Object.fromEntries(
      row.categories.map((link) => [link.categoryId, link.position]),
    ),
    optionTypes,
    variants: row.variants.map((variant) => {
      // A variant counts each value key once (two merged types may both hold "red").
      const seen = new Set<string>();
      const valueIndexes = variant.optionValues.flatMap((link) => {
        const at = place.get(link.optionValueId);
        if (!at || seen.has(`${at[0]}:${at[1]}`)) return [];
        seen.add(`${at[0]}:${at[1]}`);
        return [at];
      });
      return {
        priceCents: variant.priceCents,
        compareAtPriceCents: variant.compareAtPriceCents,
        inStock: variant.stockQuantity > 0,
        valueIndexes,
      };
    }),
  };
}
