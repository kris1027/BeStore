"use client";

import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { useStoreFormat } from "@/components/store-format-provider";

type PriceProps = {
  readonly cents: number;
  // Orders store their own currency; everything else uses the store's.
  readonly currency?: string;
  readonly className?: string;
};

export function Price({ cents, currency, className }: PriceProps) {
  const format = useStoreFormat();
  return (
    <span data-slot="price" className={cn("tabular-nums", className)}>
      {formatMoney(cents, { locale: format.locale, currency: currency ?? format.currency })}
    </span>
  );
}
