import { splitDiscount } from "@/lib/discounts/rule";
import { orderCharges, type ShippingSettings } from "@/lib/shipping/rule";

// Pure: the live cart lines, read under the cart lock, frozen into order lines and totals
// (spec 0006, Value sourcing). Nothing here reads a price or a fee from anywhere but its input.

export type SnapshotSource = {
  readonly variantId: string;
  readonly productId: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly sku: string;
  readonly imagePath: string | null;
  readonly unitPriceCents: number;
  readonly quantity: number;
};

export type OrderLineSnapshot = SnapshotSource & {
  readonly discountCents: number;
  readonly lineTotalCents: number;
};

export type OrderSnapshot = {
  readonly lines: readonly OrderLineSnapshot[];
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
};

// Delivery is the spec 0007 rule over the settings read in the same transaction. The discount
// arrives already final from cappedDiscount (spec 0014, AC-2): the caps live only in
// src/lib/discounts/rule.ts. It is split onto the lines (AC-6), so the database CHECKs hold
// line_total = unit_price * quantity - discount and total = subtotal - discount + shipping.
export function snapshotOrder(
  sources: readonly SnapshotSource[],
  settings: ShippingSettings,
  discount: { readonly discountCents: number } | null,
): OrderSnapshot {
  const amounts = sources.map((source) => source.unitPriceCents * source.quantity);
  const subtotalCents = amounts.reduce((sum, amount) => sum + amount, 0);
  const discountCents = discount?.discountCents ?? 0;
  const shares = splitDiscount(amounts, discountCents);
  const lines = sources.map((source, index): OrderLineSnapshot => {
    const share = shares[index] ?? 0;
    return {
      ...source,
      discountCents: share,
      lineTotalCents: (amounts[index] ?? 0) - share,
    };
  });
  return {
    lines,
    subtotalCents,
    discountCents,
    ...orderCharges({ subtotalCents, discountCents }, settings),
  };
}
