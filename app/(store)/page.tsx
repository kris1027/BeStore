import type { Metadata } from "next";
import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import { AccountDeletedNotice } from "@/features/account/components/account-deleted-notice";
import { ListingSkeleton } from "@/features/catalog/listing/components/listing-skeleton";
import { ListingView } from "@/features/catalog/listing/components/listing-view";
import { homePath } from "@/features/catalog/paths";
import { brand } from "@/lib/brand/brand";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

// spec 0013, AC-24: the home title stays; paged and filtered views point at the plain path.
export const metadata: Metadata = {
  alternates: { canonical: new URL(homePath, env.NEXT_PUBLIC_SITE_URL).toString() },
};

// spec 0013, AC-4: every listable product, with filters, sorts and paging. The heading is the
// static shell; the results read the search params, so they render behind Suspense.
export default function StoreHomePage({ searchParams }: PageProps<"/">) {
  return (
    <div className={cn(storeContainer, "flex flex-col gap-12 py-12 md:gap-16 md:py-16")}>
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
