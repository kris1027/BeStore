import { PackageOpenIcon, SearchIcon, SearchXIcon, StoreIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { homePath } from "../../paths";
import type { ListingKind } from "../params";

function AllProductsLink({ primary = false }: { readonly primary?: boolean }) {
  return (
    <Link
      href={homePath}
      className={buttonVariants({ variant: primary ? "default" : "outline", className: "h-11" })}
    >
      See all products
    </Link>
  );
}

// spec 0005: the home page before anything is for sale.
export function EmptyCatalog() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <StoreIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>Nothing for sale just yet</h2>
        </EmptyTitle>
        <EmptyDescription>New products are on their way. Check back soon.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// spec 0013, AC-3 and AC-21: a category with no listable products, or a search nothing matches.
// No filters either: there is nothing to narrow.
export function EmptyScope({ kind }: { readonly kind: Exclude<ListingKind, "home"> }) {
  return kind === "category" ? (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PackageOpenIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>Nothing here yet</h2>
        </EmptyTitle>
        <EmptyDescription>Products for this category are on their way.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <AllProductsLink primary />
      </EmptyContent>
    </Empty>
  ) : (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>No products match.</h2>
        </EmptyTitle>
        <EmptyDescription>Try fewer or shorter words.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <AllProductsLink />
      </EmptyContent>
    </Empty>
  );
}

// spec 0013, AC-21: the filters leave nothing.
export function NoResults({
  kind,
  clearHref,
}: {
  readonly kind: ListingKind;
  // The same listing without filters; null when none are on.
  readonly clearHref: string | null;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h3>No products match.</h3>
        </EmptyTitle>
        {kind === "search" ? (
          <EmptyDescription>Try fewer or shorter words.</EmptyDescription>
        ) : clearHref !== null ? (
          <EmptyDescription>Remove a filter or two to see more.</EmptyDescription>
        ) : null}
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        {clearHref !== null ? (
          <Link href={clearHref} scroll={false} className={buttonVariants({ className: "h-11" })}>
            Clear filters
          </Link>
        ) : null}
        {kind === "search" ? <AllProductsLink /> : null}
      </EmptyContent>
    </Empty>
  );
}

// spec 0013, AC-9: a query too short to search.
export function SearchPrompt() {
  return (
    <p className="flex items-center gap-2 text-muted-foreground">
      <SearchIcon aria-hidden="true" className="size-4" />
      Type at least 2 characters to search
    </p>
  );
}
