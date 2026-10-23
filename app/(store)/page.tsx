import type { Metadata } from "next";
import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import { AccountDeletedNotice } from "@/features/account/components/account-deleted-notice";
import { ListingSkeleton } from "@/features/catalog/listing/components/listing-skeleton";
import { pagedTitle } from "@/features/catalog/listing/canonical";
import { getListingCanonical } from "@/features/catalog/listing/canonical-query";
import { ListingView } from "@/features/catalog/listing/components/listing-view";
import { homePath } from "@/features/catalog/paths";
import { brand } from "@/lib/brand/brand";
import { JsonLdScript } from "@/lib/seo/json-ld";
import { defaultDescription, pageMetadata } from "@/lib/seo/metadata";
import { site } from "@/lib/seo/site";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/structured-data";
import { cn } from "@/lib/utils";

// spec 0018, AC-12 and AC-13: a filtered or sorted view points at the plain path; an unfiltered
// paged one at itself, titled `, page N`. Reads the search params, so it renders at request time,
// like the results; crawlers still get it in the head. No filter text ever reaches it.
export async function generateMetadata({ searchParams }: PageProps<"/">): Promise<Metadata> {
  const canonical = await getListingCanonical({ kind: "home" }, homePath, searchParams);
  return pageMetadata(
    {
      title: canonical.page > 1 ? { absolute: pagedTitle(brand.name, canonical.page) } : null,
      description: defaultDescription(brand.name),
      path: canonical.path,
    },
    site,
  );
}

// spec 0013, AC-4: every listable product, with filters, sorts and paging. The heading is the
// static shell; the results read the search params, so they render behind Suspense.
export default function StoreHomePage({ searchParams }: PageProps<"/">) {
  return (
    <div className={cn(storeContainer, "flex flex-col gap-12 py-12 md:gap-16 md:py-16")}>
      {/* spec 0018, AC-15: in the static shell. */}
      <JsonLdScript data={[organizationJsonLd(site), websiteJsonLd(site)]} />
      <Suspense fallback={null}>
        <AccountDeletedNotice />
      </Suspense>
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-4xl md:text-5xl">{brand.name}</h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          Everything we sell, in one place.
        </p>
      </header>
      <Suspense fallback={<ListingSkeleton />}>
        <ListingView
          scope={{ kind: "home" }}
          path={homePath}
          searchParams={searchParams}
          heading={{ text: "Shop all", visible: true }}
        />
      </Suspense>
    </div>
  );
}
