import { matchesWords, searchWords } from "@/lib/search-text";

import { isSaleVariant, summarizeCard } from "../product-summary";
import type { ProductCard, ProductImage } from "../queries";
import {
  activeFilterCount,
  defaultSort,
  type ListingScope,
  type ListingState,
  MAX_OPTION_GROUPS,
  reservedParams,
  type SortKey,
  sortOptions,
} from "./params";

// Pure: search, filters, counts, sort and paging over the cached listing index (spec 0013,
// Decision). No I/O, no clock, no randomness: the same index and URL give the same page.

export const PAGE_SIZE = 24;
export const SEARCH_MIN_LENGTH = 2;

export type ListingVariant = {
  readonly priceCents: number;
  readonly compareAtPriceCents: number | null;
  // Never the count itself (spec 0005), even if index rows ever reach the browser.
  readonly inStock: boolean;
  // [option type, value] indexes into the product's optionTypes, one per value key.
  readonly valueIndexes: readonly (readonly [type: number, value: number])[];
};

export type ListingOptionType = {
  readonly key: string;
  readonly label: string;
  readonly values: readonly { readonly key: string; readonly label: string }[];
};

export type ListingProduct = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly nameWords: readonly string[];
  readonly position: number;
  readonly createdAtMs: number;
  readonly image: ProductImage;
  // categoryId → the product's position in that category.
  readonly categoryPositions: Readonly<Record<string, number>>;
  // Merged by key inside the product, empty keys skipped, values in admin position order.
  readonly optionTypes: readonly ListingOptionType[];
  readonly variants: readonly ListingVariant[];
};

export type FacetValue = {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly selected: boolean;
};

export type FacetGroup = {
  readonly key: string;
  readonly label: string;
  readonly values: readonly FacetValue[];
};

// The lowest and highest live variant price of the scope before filters (AC-15).
export type PriceBounds = { readonly minCents: number; readonly maxCents: number };

export type Listing = {
  readonly status: "ok";
  readonly products: readonly ProductCard[];
  // Matches after filters, and the scope before them.
  readonly total: number;
  readonly scopeTotal: number;
  readonly page: number;
  readonly pageCount: number;
  readonly groups: readonly FacetGroup[];
  readonly inStockCount: number;
  readonly onSaleCount: number;
  readonly priceBounds: PriceBounds | null;
  // What was actually applied: unknown groups and values dropped, the page clamped (AC-18).
  readonly state: ListingState;
  readonly activeFilters: number;
};

// AC-9: no search runs for a query this short or with no words.
export type ListingResult = Listing | { readonly status: "prompt" };

export function searchQueryReady(q: string): boolean {
  return Array.from(q).length >= SEARCH_MIN_LENGTH && searchWords(q).length > 0;
}

type Compare = (a: ListingProduct, b: ListingProduct) => number;

// AC-4: products.position, created_at newest first, id descending.
const homeFeatured: Compare = (a, b) =>
  a.position - b.position ||
  b.createdAtMs - a.createdAtMs ||
  (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

// AC-1: the category's own order first.
function categoryFeatured(categoryId: string): Compare {
  return (a, b) =>
    (a.categoryPositions[categoryId] ?? 0) - (b.categoryPositions[categoryId] ?? 0) ||
    homeFeatured(a, b);
}

function minPrice(product: ListingProduct): number {
  return Math.min(...product.variants.map((variant) => variant.priceCents));
}

// AC-8: the name, word by word, starts with the query.
function bestMatch(queryWords: readonly string[]): Compare {
  const phrase = queryWords.join(" ");
  const tier = (product: ListingProduct) =>
    product.nameWords.join(" ").startsWith(phrase) ? 0 : 1;
  return (a, b) => tier(a) - tier(b) || homeFeatured(a, b);
}

// AC-16: the chosen sort, ties in the listing's default order (the array is sorted by that
// first, and toSorted is stable).
function sortCompare(sort: SortKey, featured: Compare, collator: Intl.Collator): Compare | null {
  switch (sort) {
    case "relevance":
      return null;
    case "featured":
      return featured;
    case "newest":
      return (a, b) => b.createdAtMs - a.createdAtMs;
    case "price-asc":
      return (a, b) => minPrice(a) - minPrice(b);
    case "price-desc":
      return (a, b) => minPrice(b) - minPrice(a);
    case "name":
      return (a, b) => collator.compare(a.name, b.name);
  }
}

// The value keys a variant has in each group (two merged types may give it two in one group).
function variantValues(
  product: ListingProduct,
  variant: ListingVariant,
): ReadonlyMap<string, ReadonlySet<string>> {
  const groups = new Map<string, Set<string>>();
  for (const [t, v] of variant.valueIndexes) {
    const type = product.optionTypes[t];
    const value = type?.values[v];
    if (!type || !value) continue;
    const keys = groups.get(type.key) ?? new Set<string>();
    keys.add(value.key);
    groups.set(type.key, keys);
  }
  return groups;
}

type VariantFilters = Pick<
  ListingState,
  "options" | "minCents" | "maxCents" | "inStock" | "onSale"
>;

// AC-12: one variant satisfies every active filter together. A variant without a filtered
// group never matches it.
function variantMatches(
  values: ReadonlyMap<string, ReadonlySet<string>>,
  variant: ListingVariant,
  filters: VariantFilters,
): boolean {
  if (filters.minCents !== null && variant.priceCents < filters.minCents) return false;
  if (filters.maxCents !== null && variant.priceCents > filters.maxCents) return false;
  if (filters.inStock && !variant.inStock) return false;
  if (filters.onSale && !isSaleVariant(variant)) return false;
  return filters.options.every((group) => {
    const has = values.get(group.key);
    return has !== undefined && group.values.some((value) => has.has(value));
  });
}

type Prepared = {
  readonly product: ListingProduct;
  readonly variants: readonly {
    readonly variant: ListingVariant;
    readonly values: ReadonlyMap<string, ReadonlySet<string>>;
  }[];
};

function matches(prepared: Prepared, filters: VariantFilters): boolean {
  return prepared.variants.some(({ variant, values }) => variantMatches(values, variant, filters));
}

// The most common spelling; the first seen wins a tie.
function commonLabel(counts: ReadonlyMap<string, number>): string {
  let best = "";
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

type GroupDraft = {
  // Label spelling → products using it, one per product, so the counts sum to the products.
  readonly labels: Map<string, number>;
  // Insertion order is the order of first appearance.
  readonly values: Map<string, Map<string, number>>;
};

// AC-13: the option groups of the scope before filters, walked in Featured order.
function facetDrafts(
  products: readonly ListingProduct[],
  collator: Intl.Collator,
): readonly ListingOptionType[] {
  const drafts = new Map<string, GroupDraft>();
  for (const product of products) {
    for (const type of product.optionTypes) {
      const draft = drafts.get(type.key) ?? { labels: new Map(), values: new Map() };
      draft.labels.set(type.label, (draft.labels.get(type.label) ?? 0) + 1);
      for (const value of type.values) {
        const labels = draft.values.get(value.key) ?? new Map<string, number>();
        labels.set(value.label, (labels.get(value.label) ?? 0) + 1);
        draft.values.set(value.key, labels);
      }
      drafts.set(type.key, draft);
    }
  }
  return [...drafts]
    .filter(([key, draft]) => !reservedParams.has(key) && draft.values.size > 1)
    .map(([key, draft]) => ({
      key,
      label: commonLabel(draft.labels),
      products: [...draft.labels.values()].reduce((sum, count) => sum + count, 0),
      values: [...draft.values].map(([valueKey, labels]) => ({
        key: valueKey,
        label: commonLabel(labels),
      })),
    }))
    .toSorted((a, b) => b.products - a.products || collator.compare(a.label, b.label))
    .map(({ key, label, values }) => ({ key, label, values }));
}

function toCard(product: ListingProduct): ProductCard {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    image: product.image,
    ...summarizeCard(product.variants),
  };
}

type Scoped = {
  readonly inScope: readonly ListingProduct[];
  // Orders the facet values (AC-13).
  readonly featured: Compare;
  // Orders the results when no sort is chosen.
  readonly defaultOrder: Compare;
};

// The products a listing draws from and its orders; null for a search too short to run (AC-9).
function scopeOf(index: readonly ListingProduct[], scope: ListingScope, q: string): Scoped | null {
  switch (scope.kind) {
    case "search": {
      if (!searchQueryReady(q)) return null;
      const queryWords = searchWords(q);
      return {
        inScope: index.filter((product) => matchesWords(product.nameWords, queryWords)),
        featured: homeFeatured,
        defaultOrder: bestMatch(queryWords),
      };
    }
    case "category": {
      const featured = categoryFeatured(scope.categoryId);
      return {
        inScope: index.filter(
          (product) => product.categoryPositions[scope.categoryId] !== undefined,
        ),
        featured,
        defaultOrder: featured,
      };
    }
    case "home":
      return { inScope: index, featured: homeFeatured, defaultOrder: homeFeatured };
  }
}

// The products a listing draws from, before filters; `q` only narrows a search scope.
export function inScopeProducts(
  index: readonly ListingProduct[],
  scope: ListingScope,
  q: string,
): readonly ListingProduct[] | null {
  return scopeOf(index, scope, q)?.inScope ?? null;
}

// The page a listing actually shows: past the end is the last page. Shared with the canonical
// rule (spec 0018, AC-12), so the canonical never names a page the listing does not show.
export function shownPage(
  requested: number,
  total: number,
): { readonly page: number; readonly pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { page: Math.min(requested, pageCount), pageCount };
}

export function buildListing(
  index: readonly ListingProduct[],
  scope: ListingScope,
  state: ListingState,
  locale: string,
): ListingResult {
  const { kind } = scope;
  const collator = new Intl.Collator(locale);

  const scoped = scopeOf(index, scope, state.q);
  if (scoped === null) return { status: "prompt" };
  const { inScope, featured, defaultOrder } = scoped;
  const byFeatured = inScope.toSorted(featured);

  const groupDrafts = facetDrafts(byFeatured, collator);
  const known = new Map(
    groupDrafts.map((group) => [group.key, new Set(group.values.map((v) => v.key))]),
  );
  // AC-18: the group cap counts only groups this listing offers, so unrelated params never
  // crowd out a real filter.
  const options = sortOptions(
    state.options.flatMap((group) => {
      const values = known.get(group.key);
      const kept = values ? group.values.filter((value) => values.has(value)) : [];
      return kept.length > 0 ? [{ key: group.key, values: kept }] : [];
    }),
  ).slice(0, MAX_OPTION_GROUPS);
  const filters: VariantFilters = {
    options,
    minCents: state.minCents,
    maxCents: state.maxCents,
    inStock: state.inStock,
    onSale: state.onSale,
  };

  const prepared: readonly Prepared[] = byFeatured.map((product) => ({
    product,
    variants: product.variants.map((variant) => ({
      variant,
      values: variantValues(product, variant),
    })),
  }));

  // AC-14: a value's count is the products matching with it in place of its group's own
  // selection, every other filter kept.
  const groups: readonly FacetGroup[] = groupDrafts.map((group) => {
    const selected = options.find((option) => option.key === group.key)?.values ?? [];
    const others = { ...filters, options: options.filter((option) => option.key !== group.key) };
    const counts = new Map<string, number>();
    for (const item of prepared) {
      const hit = new Set<string>();
      for (const { variant, values } of item.variants) {
        if (!variantMatches(values, variant, others)) continue;
        for (const value of values.get(group.key) ?? []) hit.add(value);
      }
      for (const value of hit) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return {
      key: group.key,
      label: group.label,
      values: group.values.map((value) => ({
        ...value,
        count: counts.get(value.key) ?? 0,
        selected: selected.includes(value.key),
      })),
    };
  });
  const inStockCount = prepared.filter((item) =>
    matches(item, { ...filters, inStock: true }),
  ).length;
  const onSaleCount = prepared.filter((item) => matches(item, { ...filters, onSale: true })).length;

  const prices = inScope.flatMap((product) =>
    product.variants.map((variant) => variant.priceCents),
  );
  const priceBounds: PriceBounds | null =
    prices.length > 0 ? { minCents: Math.min(...prices), maxCents: Math.max(...prices) } : null;

  const sortBy = sortCompare(state.sort, featured, collator);
  const ordered = inScope.toSorted(defaultOrder);
  const resultIds = new Set(
    prepared.filter((item) => matches(item, filters)).map((item) => item.product.id),
  );
  const filtered = ordered.filter((product) => resultIds.has(product.id));
  const sorted = sortBy ? filtered.toSorted(sortBy) : filtered;

  const { page, pageCount } = shownPage(state.page, sorted.length);
  const applied: ListingState = {
    ...state,
    // relevance only exists on search; the parser already enforces that.
    sort: state.sort === "relevance" && kind !== "search" ? defaultSort(kind) : state.sort,
    page,
    options,
  };
  return {
    status: "ok",
    products: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toCard),
    total: sorted.length,
    scopeTotal: inScope.length,
    page,
    pageCount,
    groups,
    inStockCount,
    onSaleCount,
    priceBounds,
    state: applied,
    activeFilters: activeFilterCount(applied),
  };
}
