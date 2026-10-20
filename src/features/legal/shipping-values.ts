import { type MoneyFormat, formatMoney } from "@/lib/money";
import type { ShippingSettings } from "@/lib/shipping/rule";

// Pure. spec 0017, AC-5: the live delivery fee and free delivery rule `/shipping` fills in, from
// the same settings the cart and checkout show.
export function shippingValues(
  settings: ShippingSettings,
  format: MoneyFormat,
): { readonly deliveryFee: string; readonly freeDeliveryRule: string } {
  const threshold = settings.freeShippingThresholdCents;
  return {
    deliveryFee: formatMoney(settings.flatShippingCents, format),
    freeDeliveryRule:
      threshold === null
        ? "The same fee applies to every order."
        : `Delivery is free on orders of ${formatMoney(threshold, format)} or more.`,
  };
}
