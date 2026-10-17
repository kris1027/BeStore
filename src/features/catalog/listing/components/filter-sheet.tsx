"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { productCount } from "../format";
import { activeFilterCount } from "../params";
import { type FilterData, FilterPanel } from "./filter-panel";
import { useListingNav } from "./listing-nav";

// spec 0013, AC-20: below lg the panel opens in a Sheet. Its open state lives here, above the
// results, so it stays open (and keeps focus) while each change applies.
export function FilterSheet({
  total,
  data,
}: {
  readonly total: number;
  readonly data: FilterData;
}) {
  const { state } = useListingNav();
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(state);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" className="h-11 lg:hidden" />}>
        <SlidersHorizontalIcon data-icon="inline-start" aria-hidden="true" />
        Filters
        {count > 0 ? (
          <span className="tabular-nums">
            <span aria-hidden="true">({count})</span>
            <span className="sr-only">, {count} active</span>
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent side="left" className="w-full max-w-sm">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4">
          <FilterPanel idPrefix="sheet-filters" formId="listing-filters-sheet" data={data} />
        </div>
        <SheetFooter>
          <SheetClose render={<Button className="h-11" />}>Show {productCount(total)}</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
