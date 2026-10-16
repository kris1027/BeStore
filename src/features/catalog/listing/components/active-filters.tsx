"use client";

import { XIcon } from "lucide-react";
import Link from "next/link";

import { useStoreFormat } from "@/components/store-format-provider";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

import type { FacetGroup } from "../listing";
import { clearedFilters, type ListingState, toggleOption, withChange } from "../params";
import { useListingNav } from "./listing-nav";

type Chip = { readonly id: string; readonly label: string; readonly next: ListingState };

function chips(
  state: ListingState,
  groups: readonly FacetGroup[],
  money: (cents: number) => string,
): readonly Chip[] {
  const options = state.options.flatMap((option) => {
    const group = groups.find((candidate) => candidate.key === option.key);
    return option.values.map((value) => ({
      id: `${option.key}=${value}`,
      label: `${group?.label ?? option.key}: ${group?.values.find((v) => v.key === value)?.label ?? value}`,
      next: toggleOption(state, option.key, value),
    }));
  });
  return [
    ...options,
    ...(state.minCents === null
      ? []
      : [
          {
            id: "min",
            label: `Min ${money(state.minCents)}`,
            next: withChange(state, { minCents: null }),
          },
        ]),
    ...(state.maxCents === null
      ? []
      : [
          {
            id: "max",
            label: `Max ${money(state.maxCents)}`,
            next: withChange(state, { maxCents: null }),
          },
        ]),
    ...(state.inStock
      ? [{ id: "stock", label: "In stock", next: withChange(state, { inStock: false }) }]
      : []),
    ...(state.onSale
      ? [{ id: "sale", label: "On sale", next: withChange(state, { onSale: false }) }]
      : []),
  ];
}

// spec 0013, AC-20: each active filter as a removable chip, plus Clear all (the query stays).
// Links, so they work without JavaScript; with it, Next keeps the page and the panel.
export function ActiveFilters({ groups }: { readonly groups: readonly FacetGroup[] }) {
  const { state, href } = useListingNav();
  const format = useStoreFormat();
  const list = chips(state, groups, (cents) => formatMoney(cents, format));
  if (list.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul aria-label="Active filters" className="flex flex-wrap gap-2">
        {list.map((chip) => (
          <li key={chip.id}>
            <Link
              href={href(chip.next)}
              scroll={false}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "h-9 rounded-full pr-2.5 pl-3.5",
              )}
            >
              {chip.label}
              <XIcon data-icon="inline-end" aria-hidden="true" />
              <span className="sr-only">, remove</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={href(clearedFilters(state))}
        scroll={false}
        className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-9")}
      >
        Clear all
      </Link>
    </div>
  );
}
