"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

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

// spec 0013, AC-16, and spec 0016: a native select joins the filter form, so it also submits
// without JavaScript (the Base UI Select needs it). 44px tall, like the other storefront targets.
export function SortSelect() {
  const { state, apply, kind } = useListingNav();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="listing-sort" className="shrink-0 font-normal text-muted-foreground">
        Sort by
      </Label>
      <NativeSelect
        id="listing-sort"
        name="sort"
        form={FILTER_FORM_ID}
        value={state.sort}
        onChange={(event) => {
          const sort = sortsFor(kind).find((key) => key === event.target.value);
          if (sort) apply(withChange(state, { sort }));
        }}
        className="*:data-[slot=native-select]:h-11"
      >
        {sortsFor(kind).map((key) => (
          <NativeSelectOption key={key} value={key}>
            {sortLabels[key]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
