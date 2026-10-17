import { env } from "@/lib/env";

import { ProductCard } from "../../components/product-card";
import { getListingIndex } from "../index-query";
import { buildListing } from "../listing";
import { clearedFilters, type ListingScope, listingLinks, parseListingParams } from "../params";
import { ListingControls, type ListingHeading } from "./listing-controls";
import { EmptyCatalog, EmptyScope, NoResults, SearchPrompt } from "./listing-empty";
import { Pagination } from "./pagination";

// The first row loads eagerly: it is what a visitor sees without scrolling.
const EAGER_CARDS = 4;

type SearchParams = Record<string, string | string[] | undefined>;

// spec 0013: one listing (home, category or search) for the URL's state. It reads the search
// params, so it renders per request behind the page's Suspense boundary (AC-22). Nothing here
// logs: search text never leaves the request (AC-10).
export async function ListingView({
  scope,
  path,
  searchParams,
  heading,
}: {
  readonly scope: ListingScope;
  // The listing's own path, without a query.
  readonly path: string;
  readonly searchParams: Promise<SearchParams>;
  readonly heading: ListingHeading;
}) {
  const { kind } = scope;
  const state = parseListingParams(await searchParams, kind, env.STORE_CURRENCY);
  const listing = buildListing(await getListingIndex(), scope, state, env.STORE_LOCALE);

  if (listing.status === "prompt") return <SearchPrompt />;
  if (listing.scopeTotal === 0) {
    return kind === "home" ? <EmptyCatalog /> : <EmptyScope kind={kind} />;
  }
  const href = listingLinks(path, kind, env.STORE_CURRENCY);

  return (
    <ListingControls
      kind={kind}
      path={path}
      heading={heading}
      state={listing.state}
      total={listing.total}
      groups={listing.groups}
      inStockCount={listing.inStockCount}
      onSaleCount={listing.onSaleCount}
      priceBounds={listing.priceBounds}
    >
      {listing.total === 0 ? (
        <NoResults
          kind={kind}
          clearHref={listing.activeFilters > 0 ? href(clearedFilters(listing.state)) : null}
        />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:gap-x-6 xl:grid-cols-4">
            {listing.products.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                priority={listing.page === 1 && index < EAGER_CARDS}
              />
            ))}
          </ul>
          <Pagination
            page={listing.page}
            pageCount={listing.pageCount}
            pageHref={(page) => href({ ...listing.state, page })}
          />
        </>
      )}
    </ListingControls>
  );
}
