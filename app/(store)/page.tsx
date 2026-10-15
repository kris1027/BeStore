import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import { AccountDeletedNotice } from "@/features/account/components/account-deleted-notice";
import { ProductGrid } from "@/features/catalog/components/product-grid";
import { brand } from "@/lib/brand/brand";
import { cn } from "@/lib/utils";

// Served from the cache: the grid's read is tagged `catalog` (spec 0005, AC-6).
export default function StoreHomePage() {
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
      <ProductGrid />
    </div>
  );
}
