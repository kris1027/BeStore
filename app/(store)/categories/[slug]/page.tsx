import type { Metadata } from "next";
import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import { pagedTitle } from "@/features/catalog/listing/canonical";
import { getListingCanonical } from "@/features/catalog/listing/canonical-query";
import { ListingSkeleton } from "@/features/catalog/listing/components/listing-skeleton";
import { ListingView } from "@/features/catalog/listing/components/listing-view";
import {
  CategoryHeader,
  CategoryHeaderSkeleton,
} from "@/features/categories/components/category-header";
import { categoryPath } from "@/features/categories/paths";
import { getCategoryBySlug, getPrerenderedCategorySlugs } from "@/features/categories/queries";
import { pageMetadata } from "@/lib/seo/metadata";
import { site } from "@/lib/seo/site";
import { META_DESCRIPTION_MAX, plainExcerpt, presentText } from "@/lib/seo/text";
import { cn } from "@/lib/utils";

// Cannot match the slug pattern, so it renders the 404 page. Cache Components refuses an empty
// list, and a store with no visible category has no slugs to give.
const NO_CATEGORY_SLUG = "__none__";

export async function generateStaticParams() {
  const slugs = await getPrerenderedCategorySlugs();
  return slugs.length > 0 ? slugs.map((slug) => ({ slug })) : [{ slug: NO_CATEGORY_SLUG }];
}

// spec 0018, AC-12 to AC-14: the search params decide only the canonical page, through the
// parsed listing state; no filter text ever reaches the metadata (spec 0013, AC-24).
export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/categories/[slug]">): Promise<Metadata> {
  const category = await getCategoryBySlug((await params).slug);
  // AC-21: notFound() in the header adds the noindex.
  if (!category) return { title: "Page not found" };
  const canonical = await getListingCanonical(
    { kind: "category", categoryId: category.id },
    categoryPath(category.slug),
    searchParams,
  );
  return pageMetadata(
    {
      title: pagedTitle(presentText(category.metaTitle) ?? category.name, canonical.page),
      description:
        presentText(category.metaDescription) ??
        plainExcerpt(category.description ?? "", META_DESCRIPTION_MAX),
      path: canonical.path,
    },
    site,
  );
}

// The page joins the two features: the category from categories, the listing from catalog.
async function CategoryListing({
  params,
  searchParams,
}: Pick<PageProps<"/categories/[slug]">, "params" | "searchParams">) {
  const category = await getCategoryBySlug((await params).slug);
  // The header shows the not found page.
  if (!category) return null;
  return (
    <ListingView
      scope={{ kind: "category", categoryId: category.id }}
      path={categoryPath(category.slug)}
      searchParams={searchParams}
      heading={{ text: "Products", visible: false }}
    />
  );
}

// spec 0013, AC-1 to AC-3. The header reads only the path (static for prerendered slugs); the
// results read the search params, so they render per request.
export default function CategoryPage({ params, searchParams }: PageProps<"/categories/[slug]">) {
  return (
    <div className={cn(storeContainer, "flex flex-col gap-10 py-12 md:gap-12 md:py-16")}>
      <Suspense fallback={<CategoryHeaderSkeleton />}>
        <CategoryHeader params={params} />
      </Suspense>
      <Suspense fallback={<ListingSkeleton />}>
        <CategoryListing params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
