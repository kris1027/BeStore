"use client";

import { ChevronDownIcon } from "lucide-react";

import { Label } from "@/components/ui/label";

import { type SortKey, sortsFor, withChange } from "../params";
import { FILTER_FORM_ID } from "./filter-panel";
import { useListingNav } from "./listing-nav";

const sortLabels: Readonly<Record<SortKey, string>> = {
  relevance: "Best match",
  featured: "Featured",
  newest: "Newest",
  "price-asc": "Price low to high",
  "price-desc": "Price high to low",
  name: "Name A to Z",
};

// spec 0013, AC-16. A native select: it joins the filter form, so it also submits without
// JavaScript (the Base UI Select needs it).
export function SortSelect() {
  const { state, apply, kind } = useListingNav();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="listing-sort" className="shrink-0 font-normal text-muted-foreground">
        Sort by
      </Label>
      <div className="relative">
        <select
          id="listing-sort"
          name="sort"
          form={FILTER_FORM_ID}
          value={state.sort}
          onChange={(event) => {
            const sort = sortsFor(kind).find((key) => key === event.target.value);
            if (sort) apply(withChange(state, { sort }));
          }}
          className="h-11 appearance-none rounded-md border border-input bg-background py-2 pr-9 pl-3 text-sm shadow-xs"
        >
          {sortsFor(kind).map((key) => (
            <option key={key} value={key}>
              {sortLabels[key]}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </div>
  );
}
