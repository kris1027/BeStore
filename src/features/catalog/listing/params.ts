import { z } from "zod";

import { centsToInput, parseMoney } from "@/lib/money";
import { facetKey } from "@/lib/search-text";

// Pure: a listing's whole state as it lives in the URL (spec 0013, AC-17, AC-18). Every input
// maps to a valid state, never an error, so a shared or hand edited link always opens.

export type ListingScope =
  | { readonly kind: "home" }
  | { readonly kind: "category"; readonly categoryId: string }
  | { readonly kind: "search" };

export type ListingKind = ListingScope["kind"];

export const sortKeys = [
  "relevance",
  "featured",
  "newest",
  "price-asc",
  "price-desc",
  "name",
] as const;
export type SortKey = (typeof sortKeys)[number];

export type OptionFilter = { readonly key: string; readonly values: readonly string[] };

export type ListingState = {
  // Search only; "" elsewhere.
  readonly q: string;
  readonly sort: SortKey;
  // 1 based. The parser keeps any positive number; buildListing clamps it to the last page.
  readonly page: number;
  // Inclusive, in minor units; min never above max.
  readonly minCents: number | null;
  readonly maxCents: number | null;
  readonly inStock: boolean;
  readonly onSale: boolean;
  // Groups sorted by key and values by key, so one state has one URL.
  readonly options: readonly OptionFilter[];
};

export const SEARCH_QUERY_MAX = 100;
export const MAX_OPTION_GROUPS = 10;
export const MAX_OPTION_VALUES = 20;

// Query params with a meaning of their own; an option group with one of these keys is never
// offered (AC-13), so the two can never collide.
export const reservedParams: ReadonlySet<string> = new Set([
  "q",
  "sort",
  "page",
  "min",
  "max",
  "stock",
  "sale",
]);

export function defaultSort(kind: ListingKind): SortKey {
  return kind === "search" ? "relevance" : "featured";
}

export function sortsFor(kind: ListingKind): readonly SortKey[] {
  return kind === "search" ? sortKeys : sortKeys.filter((key) => key !== "relevance");
}

const emptyState: ListingState = {
  q: "",
  sort: "featured",
  page: 1,
  minCents: null,
  maxCents: null,
  inStock: false,
  onSale: false,
  options: [],
};

export type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;

// AC-18: a repeated scalar param keeps its first value.
const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === "string" ? value : value?.[0];

const all = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === "string" ? [value] : value;

const pageSchema = z
  .string()
  .regex(/^\d+$/)
  // A page past the end renders the last page, so a huge number only needs to stay a number.
  .transform((text) => Math.max(1, Math.min(Number(text), Number.MAX_SAFE_INTEGER)))
  .catch(1);

// Only the exact "1" turns a toggle on; anything else is off.
const flagSchema = z
  .literal("1")
  .transform(() => true)
  .catch(false);

const sortSchema = (kind: ListingKind) =>
  z
    .enum(sortKeys)
    .refine((key) => sortsFor(kind).includes(key))
    .catch(defaultSort(kind));

// The bounds stay text here: withPrices parses and repairs them like the typed inputs.
const priceTextSchema = z.string().catch("");

// AC-6: trimmed, then capped at whole characters, never a split surrogate pair.
const querySchema = z
  .string()
  .transform((text) => Array.from(text.trim()).slice(0, SEARCH_QUERY_MAX).join(""))
  .catch("");

// The search query as the listing and the search page's own box read it.
export function searchQuery(params: RawParams): string {
  return querySchema.parse(first(params.q));
}

// A decimal comma ("10,50", as shoppers in comma locales type it) reads as a point; parseMoney
// stays the one parser (AC-15). The URL always carries the point form.
function price(text: string | undefined, currency: string): number | null {
  if (text === undefined) return null;
  const parsed = parseMoney(text.trim().replace(/^(\d+),(\d+)$/, "$1.$2"), currency);
  return parsed.ok ? parsed.cents : null;
}

// Unknown groups and values are dropped later by buildListing, which knows the listing's
// filters; here they are only normalized, deduplicated and capped per group. The group cap
// (MAX_OPTION_GROUPS) waits for buildListing too: counted here, tracking params such as
// `utm_source` or `fbclid` would push a real filter out of a shared link (AC-17).
function optionFilters(params: RawParams): readonly OptionFilter[] {
  const groups = new Map<string, string[]>();
  for (const [name, value] of Object.entries(params)) {
    const key = facetKey(name);
    if (key === "" || reservedParams.has(key)) continue;
    const values = groups.get(key) ?? [];
    for (const raw of all(value)) {
      const valueKey = facetKey(raw);
      if (valueKey === "" || values.includes(valueKey) || values.length >= MAX_OPTION_VALUES) {
        continue;
      }
      values.push(valueKey);
    }
    if (values.length > 0) groups.set(key, values);
  }
  return sortOptions([...groups].map(([key, values]) => ({ key, values })));
}

export function sortOptions(options: readonly OptionFilter[]): readonly OptionFilter[] {
  return options
    .map((group) => ({ key: group.key, values: group.values.toSorted() }))
    .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function parseListingParams(
  params: RawParams,
  kind: ListingKind,
  currency: string,
): ListingState {
  const prices = withPrices(
    emptyState,
    priceTextSchema.parse(first(params.min)),
    priceTextSchema.parse(first(params.max)),
    currency,
  );
  return {
    q: kind === "search" ? searchQuery(params) : "",
    sort: sortSchema(kind).parse(first(params.sort)),
    page: pageSchema.parse(first(params.page)),
    minCents: prices.minCents,
    maxCents: prices.maxCents,
    inStock: flagSchema.parse(first(params.stock)),
    onSale: flagSchema.parse(first(params.sale)),
    options: optionFilters(params),
  };
}

// The URL form of a price: major units, without a zero fraction ("12", "12.50").
export function priceParam(cents: number, currency: string): string {
  return centsToInput(cents, currency).replace(/\.0+$/, "");
}

// AC-17: one stable order and no defaults, so one state has one URL. Page 1 has no `page`.
export function listingHref(
  path: string,
  state: ListingState,
  kind: ListingKind,
  currency: string,
): string {
  const query = new URLSearchParams();
  if (kind === "search" && state.q !== "") query.append("q", state.q);
  if (state.sort !== defaultSort(kind)) query.append("sort", state.sort);
  if (state.minCents !== null) query.append("min", priceParam(state.minCents, currency));
  if (state.maxCents !== null) query.append("max", priceParam(state.maxCents, currency));
  if (state.inStock) query.append("stock", "1");
  if (state.onSale) query.append("sale", "1");
  for (const group of sortOptions(state.options)) {
    for (const value of group.values) query.append(group.key, value);
  }
  if (state.page > 1) query.append("page", String(state.page));
  const text = query.toString();
  return text === "" ? path : `${path}?${text}`;
}

// A listing's links: its path, kind and the store currency bound once, so callers pass a state.
export function listingLinks(
  path: string,
  kind: ListingKind,
  currency: string,
): (state: ListingState) => string {
  return (state) => listingHref(path, state, kind, currency);
}

// Any filter or sort change starts again at page 1 (AC-17).
export function withChange(state: ListingState, change: Partial<ListingState>): ListingState {
  return { ...state, page: 1, ...change };
}

// What "Clear all" and "Clear filters" lead to: the sort and the query stay (AC-20, AC-21).
export function clearedFilters(state: ListingState): ListingState {
  return withChange(state, {
    minCents: null,
    maxCents: null,
    inStock: false,
    onSale: false,
    options: [],
  });
}

export function toggleOption(
  state: ListingState,
  groupKey: string,
  valueKey: string,
): ListingState {
  const current = state.options.find((group) => group.key === groupKey)?.values ?? [];
  const values = current.includes(valueKey)
    ? current.filter((value) => value !== valueKey)
    : [...current, valueKey];
  const others = state.options.filter((group) => group.key !== groupKey);
  return withChange(state, {
    options: sortOptions(values.length > 0 ? [...others, { key: groupKey, values }] : others),
  });
}

// AC-20: one per selected value, per price bound and per toggle.
export function activeFilterCount(state: ListingState): number {
  return (
    state.options.reduce((sum, group) => sum + group.values.length, 0) +
    (state.minCents === null ? 0 : 1) +
    (state.maxCents === null ? 0 : 1) +
    (state.inStock ? 1 : 0) +
    (state.onSale ? 1 : 0)
  );
}

// The price inputs as typed, with the parser's repair rules: unparsable dropped, min above max
// swapped (AC-15, AC-18).
export function withPrices(
  state: ListingState,
  minText: string,
  maxText: string,
  currency: string,
): ListingState {
  const min = price(minText === "" ? undefined : minText, currency);
  const max = price(maxText === "" ? undefined : maxText, currency);
  const swap = min !== null && max !== null && min > max;
  return withChange(state, { minCents: swap ? max : min, maxCents: swap ? min : max });
}
