// Pure: the live cart lines, read under the cart lock, frozen into order lines and totals
// (spec 0006, Value sourcing). Nothing here reads a price from anywhere but its input.

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

// Discounts (feature 14) and shipping (feature 8) are 0 until those features fill them; the
// database CHECKs hold total = subtotal - discount + shipping either way.
export function snapshotOrder(sources: readonly SnapshotSource[]): OrderSnapshot {
  const lines = sources.map((source): OrderLineSnapshot => ({
    ...source,
    discountCents: 0,
    lineTotalCents: source.unitPriceCents * source.quantity,
  }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const discountCents = 0;
  const shippingCents = 0;
  return {
    lines,
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + shippingCents,
  };
}
