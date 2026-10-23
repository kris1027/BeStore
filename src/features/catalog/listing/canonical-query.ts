import "server-only";

import { env } from "@/lib/env";

import { type ListingCanonical, listingCanonical } from "./canonical";
import { getListingIndex } from "./index-query";
import { inScopeProducts } from "./listing";
import { type ListingScope, parseListingParams, type RawParams } from "./params";

// The canonical of a home or category view (spec 0018, AC-12), counted from the same cached
// index the listing reads, scoped the same way.
export async function getListingCanonical(
  scope: Exclude<ListingScope, { kind: "search" }>,
  path: string,
  searchParams: Promise<RawParams>,
): Promise<ListingCanonical> {
  const state = parseListingParams(await searchParams, scope.kind, env.STORE_CURRENCY);
  const inScope = inScopeProducts(await getListingIndex(), scope, "") ?? [];
  return listingCanonical(path, state, scope.kind, inScope.length);
}
