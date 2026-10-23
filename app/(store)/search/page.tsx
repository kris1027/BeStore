import type { Metadata } from "next";
import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import { ListingSkeleton } from "@/features/catalog/listing/components/listing-skeleton";
import { ListingView } from "@/features/catalog/listing/components/listing-view";
import { SearchForm } from "@/features/catalog/listing/components/search-box";
import { searchQuery } from "@/features/catalog/listing/params";
import { searchPath } from "@/features/catalog/paths";
import { storePageMetadata } from "@/lib/seo/site";
import { cn } from "@/lib/utils";

// spec 0013, AC-24 and spec 0018, AC-17: the query never reaches the title or any metadata;
// results are `noindex, follow`, with no canonical and the brand card as the share image.
export const metadata: Metadata = storePageMetadata({
  title: "Search",
  description: null,
  path: searchPath,
  indexable: false,
});

async function SearchResults({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const query = searchQuery(await searchParams);
  return (
    <div className="flex flex-col gap-10">
      {/* Keyed by the query, so a new search shows its own text in the box. */}
      <SearchForm
        key={query}
        id="search-query"
        label="Search products"
        defaultValue={query}
        className="max-w-xl"
      />
      <ListingView
        scope={{ kind: "search" }}
        path={searchPath}
        searchParams={searchParams}
        heading={{ text: "Results", visible: false }}
      />
    </div>
  );
}

// spec 0013, AC-6 to AC-9: the box and the results both read the query, so both sit behind
// Suspense; the heading is the static shell.
export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className={cn(storeContainer, "flex flex-col gap-8 py-12 md:py-16")}>
      <h1 className="font-heading text-4xl md:text-5xl">Search</h1>
      <Suspense fallback={<ListingSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
