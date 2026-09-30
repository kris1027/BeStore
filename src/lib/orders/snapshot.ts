import { type ShippingSettings, shippingCents } from "@/lib/shipping/rule";

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

// Discounts stay 0 until feature 14 fills them; the database CHECKs hold
// total = subtotal - discount + shipping either way.
export const NO_DISCOUNT_CENTS = 0;

// Delivery is the spec 0007 rule over the settings read in the same transaction.
export function snapshotOrder(
  sources: readonly SnapshotSource[],
  settings: ShippingSettings,
): OrderSnapshot {
  const lines = sources.map((source): OrderLineSnapshot => ({
    ...source,
    discountCents: 0,
    lineTotalCents: source.unitPriceCents * source.quantity,
  }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discountCents = NO_DISCOUNT_CENTS;
  const shipping = shippingCents({ subtotalCents, discountCents }, settings);
  return {
    lines,
    subtotalCents,
    discountCents,
    shippingCents: shipping,
    totalCents: subtotalCents - discountCents + shipping,
  };
}
