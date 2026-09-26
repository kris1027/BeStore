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
