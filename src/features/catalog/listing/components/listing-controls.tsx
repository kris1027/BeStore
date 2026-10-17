"use client";

import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

import { productCount } from "../format";
import type { ListingKind, ListingState } from "../params";
import { ActiveFilters } from "./active-filters";
import { type FilterData, FILTER_FORM_ID, FilterPanel } from "./filter-panel";
import { FilterSheet } from "./filter-sheet";
import { ListingNavProvider, useListingNav } from "./listing-nav";
import { SortSelect } from "./sort-select";

// The results heading: visible on home ("Shop all"), for screen readers elsewhere.
export type ListingHeading = { readonly text: string; readonly visible: boolean };

type ListingControlsProps = FilterData & {
  readonly kind: ListingKind;
  readonly path: string;
  readonly heading: ListingHeading;
  readonly state: ListingState;
  readonly total: number;
  // The results: the grid and pagination, or the no results state.
  readonly children: React.ReactNode;
};

function ResultsArea({
  heading,
  total,
  data,
  children,
}: {
  readonly heading: ListingHeading;
  readonly total: number;
  readonly data: FilterData;
  readonly children: React.ReactNode;
}) {
  const { pending } = useListingNav();
  const hydrated = useHydrated();

  return (
    <section aria-labelledby="results-heading" className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h2
            id="results-heading"
            className={heading.visible ? "font-heading text-3xl" : "sr-only"}
          >
            {heading.text}
          </h2>
          {/* AC-20: announced politely after each change. */}
          <p role="status" className="text-sm text-muted-foreground tabular-nums">
            {productCount(total)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hydrated ? <FilterSheet total={total} data={data} /> : null}
          {/* Without JavaScript the sort joins the filter form, so the panel's one Apply
              (AC-19) submits both. */}
          <SortSelect />
        </div>
      </div>
      <ActiveFilters groups={data.groups} />
      <div
        aria-busy={pending}
        className={cn("flex flex-col gap-12 transition-opacity", pending && "opacity-60")}
      >
        {children}
      </div>
    </section>
  );
}

// spec 0013, AC-11 to AC-21: the filter sidebar (a Sheet on small screens), sort, chips and the
// live result count around the server rendered results.
export function ListingControls({
  kind,
  path,
  heading,
  state,
  total,
  groups,
  inStockCount,
  onSaleCount,
  priceBounds,
  children,
}: ListingControlsProps) {
  const hydrated = useHydrated();
  const data: FilterData = { groups, inStockCount, onSaleCount, priceBounds };

  return (
    <ListingNavProvider kind={kind} path={path} state={state}>
      <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        {/* Without JavaScript there is no Sheet, so the panel shows on every screen size. */}
        <aside
          aria-labelledby="filters-heading"
          className={cn("flex flex-col gap-4", hydrated && "hidden lg:flex")}
        >
          <h2 id="filters-heading" className="text-base font-medium">
            Filters
          </h2>
          <FilterPanel idPrefix="filters" formId={FILTER_FORM_ID} data={data} />
        </aside>
        <ResultsArea heading={heading} total={total} data={data}>
          {children}
        </ResultsArea>
      </div>
    </ListingNavProvider>
  );
}
