"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

import type { FacetGroup } from "../listing";
import { priceParam, toggleOption, withChange, withPrices } from "../params";
import { useListingNav } from "./listing-nav";

export const FILTER_FORM_ID = "listing-filters";

export type FilterData = {
  readonly groups: readonly FacetGroup[];
  readonly inStockCount: number;
  readonly onSaleCount: number;
  readonly priceBounds: { readonly minCents: number; readonly maxCents: number } | null;
};

// Native checkboxes, not the Base UI one: it needs JavaScript to toggle, and the panel must also
// work as a plain GET form (AC-19).
function CheckRow({
  id,
  name,
  value,
  label,
  count,
  checked,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: () => void;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3">
      <input
        type="checkbox"
        id={id}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
      />
      <Label
        htmlFor={id}
        className={cn("flex-1 font-normal", disabled && "cursor-not-allowed opacity-60")}
      >
        {label}
        <span aria-hidden="true" className="ml-auto text-muted-foreground tabular-nums">
          {count}
        </span>
        <span className="sr-only">
          ({count} {count === 1 ? "product" : "products"})
        </span>
      </Label>
    </div>
  );
}

const fieldsetClass = "flex min-w-0 flex-col gap-1";
const legendClass = "mb-2 text-sm font-medium";

// AC-15: Min and Max in major units, applied on blur or Enter. The text stays what was typed
// until the applied value changes; a dropped value empties its box.
function PriceRange({
  idPrefix,
  bounds,
}: {
  readonly idPrefix: string;
  readonly bounds: FilterData["priceBounds"];
}) {
  const { state, apply, currency } = useListingNav();
  const shown = (cents: number | null) => (cents === null ? "" : priceParam(cents, currency));
  const applied = `${shown(state.minCents)}|${shown(state.maxCents)}`;
  const [seen, setSeen] = useState(applied);
  const [min, setMin] = useState(shown(state.minCents));
  const [max, setMax] = useState(shown(state.maxCents));
  if (seen !== applied) {
    setSeen(applied);
    setMin(shown(state.minCents));
    setMax(shown(state.maxCents));
  }

  function commit() {
    const next = withPrices(state, min.trim(), max.trim(), currency);
    setMin(shown(next.minCents));
    setMax(shown(next.maxCents));
    if (next.minCents !== state.minCents || next.maxCents !== state.maxCents) apply(next);
  }

  const field = (
    which: "min" | "max",
    value: string,
    set: (text: string) => void,
    placeholder: number | undefined,
  ) => (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <Label htmlFor={`${idPrefix}-${which}`}>
        {which === "min" ? "Min" : "Max"} ({currency})
      </Label>
      <Input
        id={`${idPrefix}-${which}`}
        name={which}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder === undefined ? undefined : priceParam(placeholder, currency)}
        onChange={(event) => set(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
        className="h-11"
      />
    </div>
  );

  return (
    <fieldset className={fieldsetClass}>
      <legend className={legendClass}>Price</legend>
      <div className="flex gap-3">
        {field("min", min, setMin, bounds?.minCents)}
        {field("max", max, setMax, bounds?.maxCents)}
      </div>
    </fieldset>
  );
}

// spec 0013, AC-11 to AC-15: price, stock, sale and one group per option type. A GET form to
// the listing's own path: with JavaScript each change applies at once, without it Apply submits.
export function FilterPanel({
  idPrefix,
  formId,
  data,
}: {
  readonly idPrefix: string;
  readonly formId: string;
  readonly data: FilterData;
}) {
  const { state, apply, kind, path } = useListingNav();
  const hydrated = useHydrated();

  return (
    <form
      id={formId}
      method="get"
      action={path}
      aria-label="Filters"
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        if (hydrated) event.preventDefault();
      }}
    >
      {kind === "search" ? <input type="hidden" name="q" value={state.q} /> : null}
      <PriceRange idPrefix={idPrefix} bounds={data.priceBounds} />
      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>Availability</legend>
        <CheckRow
          id={`${idPrefix}-stock`}
          name="stock"
          value="1"
          label="In stock only"
          count={data.inStockCount}
          checked={state.inStock}
          disabled={false}
          onChange={() => apply(withChange(state, { inStock: !state.inStock }))}
        />
        <CheckRow
          id={`${idPrefix}-sale`}
          name="sale"
          value="1"
          label="On sale only"
          count={data.onSaleCount}
          checked={state.onSale}
          disabled={false}
          onChange={() => apply(withChange(state, { onSale: !state.onSale }))}
        />
      </fieldset>
      {data.groups.map((group) => {
        const selected = state.options.find((option) => option.key === group.key)?.values ?? [];
        return (
          <fieldset key={group.key} className={fieldsetClass}>
            <legend className={legendClass}>{group.label}</legend>
            {group.values.map((value) => {
              const checked = selected.includes(value.key);
              return (
                <CheckRow
                  key={value.key}
                  id={`${idPrefix}-${group.key}-${value.key}`}
                  name={group.key}
                  value={value.key}
                  label={value.label}
                  count={value.count}
                  checked={checked}
                  // AC-14: nothing would match with it, unless it is already on.
                  disabled={value.count === 0 && !checked}
                  onChange={() => apply(toggleOption(state, group.key, value.key))}
                />
              );
            })}
          </fieldset>
        );
      })}
      {hydrated ? null : (
        <Button type="submit" className="h-11">
          Apply
        </Button>
      )}
    </form>
  );
}
