import { availability } from "@/lib/availability";

type VariantFacts = { readonly priceCents: number; readonly stockQuantity: number };

export type ProductSummary = {
  readonly variantCount: number;
  readonly totalStock: number;
  readonly minPriceCents: number;
  readonly maxPriceCents: number;
  readonly soldOut: boolean;
};

// Price range, stock and sold out state over a product's non archived variants; callers pass
// only those. A product with none (never written by this slice) counts as sold out at 0.
export function summarizeVariants(variants: readonly VariantFacts[]): ProductSummary {
  const prices = variants.map((variant) => variant.priceCents);
  return {
    variantCount: variants.length,
    totalStock: variants.reduce((sum, variant) => sum + variant.stockQuantity, 0),
    minPriceCents: prices.length > 0 ? Math.min(...prices) : 0,
    maxPriceCents: prices.length > 0 ? Math.max(...prices) : 0,
    soldOut: variants.every((variant) => availability(variant.stockQuantity).kind === "sold_out"),
  };
}

// spec 0009, AC-16: a card shows "Sale" when a variant a customer could buy now has a compare at
// price. Callers pass only non archived variants.
export function isOnSale(
  variants: readonly {
    readonly stockQuantity: number;
    readonly compareAtPriceCents: number | null;
  }[],
): boolean {
  return variants.some(
    (variant) => variant.stockQuantity > 0 && variant.compareAtPriceCents !== null,
  );
}
