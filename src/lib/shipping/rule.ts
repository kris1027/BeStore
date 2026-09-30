// Pure: the one place the delivery fee rule lives (spec 0007, AC-3). The cart, the checkout
// summary, Pay and every label call it, so they can never disagree on what delivery costs.

export type ShippingSettings = {
  readonly flatShippingCents: number;
  // null: delivery is never free, whatever the order is worth.
  readonly freeShippingThresholdCents: number | null;
};

export type ShippingBasis = {
  readonly subtotalCents: number;
  readonly discountCents: number;
};

export function shippingCents(basis: ShippingBasis, settings: ShippingSettings): number {
  const threshold = settings.freeShippingThresholdCents;
  if (threshold !== null && basis.subtotalCents - basis.discountCents >= threshold) return 0;
  return settings.flatShippingCents;
}

// How much more the customer must spend for free delivery, or null when there is nothing to
// gain: no threshold, already reached, or delivery free anyway (a flat fee of 0).
export function freeDeliveryGapCents(
  basis: ShippingBasis,
  settings: ShippingSettings,
): number | null {
  const threshold = settings.freeShippingThresholdCents;
  if (threshold === null || shippingCents(basis, settings) === 0) return null;
  return threshold - (basis.subtotalCents - basis.discountCents);
}

export type DeliveryLabel = "Standard delivery" | "Free delivery";

export function deliveryLabel(cents: number): DeliveryLabel {
  return cents === 0 ? "Free delivery" : "Standard delivery";
}
