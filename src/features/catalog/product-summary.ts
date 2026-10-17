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

type CardVariant = {
  readonly priceCents: number;
  readonly compareAtPriceCents: number | null;
  readonly inStock: boolean;
};

// spec 0009, AC-16: "Sale" means a variant a customer could buy now has a compare at price. The
// "On sale only" filter (spec 0013, AC-12) reads the same rule.
export function isSaleVariant(variant: CardVariant): boolean {
  return variant.inStock && variant.compareAtPriceCents !== null;
}

export type CardSummary = {
  readonly minPriceCents: number;
  readonly maxPriceCents: number;
  readonly soldOut: boolean;
  readonly onSale: boolean;
};

// What a product card shows, from availability alone: the listing index never holds a stock
// count. Callers pass only non archived variants; none at all reads as sold out at 0.
export function summarizeCard(variants: readonly CardVariant[]): CardSummary {
  const prices = variants.map((variant) => variant.priceCents);
  return {
    minPriceCents: prices.length > 0 ? Math.min(...prices) : 0,
    maxPriceCents: prices.length > 0 ? Math.max(...prices) : 0,
    soldOut: !variants.some((variant) => variant.inStock),
    onSale: variants.some(isSaleVariant),
  };
}
