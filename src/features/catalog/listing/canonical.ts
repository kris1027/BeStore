import { shownPage } from "./listing";
import { defaultSort, type ListingKind, type ListingState } from "./params";

// Pure (spec 0018, AC-12 and AC-13): the canonical of a home or category view, on the parsed
// state, never the raw params. A filtered or sorted view points at the plain path; an unfiltered
// one at the page it actually shows, so `?page=99` on three pages says page 3.

export type ListingCanonical = {
  // Relative to the site; the plain path for page 1.
  readonly path: string;
  // Above 1 only for an unfiltered paged view, which then titles itself `, page N`.
  readonly page: number;
};

function isPlainView(state: ListingState, kind: ListingKind): boolean {
  return (
    state.minCents === null &&
    state.maxCents === null &&
    !state.inStock &&
    !state.onSale &&
    state.options.length === 0 &&
    state.sort === defaultSort(kind)
  );
}

export function listingCanonical(
  path: string,
  state: ListingState,
  kind: ListingKind,
  // The products in the listing's scope before filters (inScopeProducts).
  scopeTotal: number,
): ListingCanonical {
  if (!isPlainView(state, kind)) return { path, page: 1 };
  const { page } = shownPage(state.page, scopeTotal);
  return page > 1 ? { path: `${path}?page=${page}`, page } : { path, page: 1 };
}

// AC-13: `Shoes, page 2`; page 1 keeps the plain title.
export function pagedTitle(title: string, page: number): string {
  return page > 1 ? `${title}, page ${page}` : title;
}
