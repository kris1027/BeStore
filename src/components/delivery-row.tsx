import { Price } from "@/components/price";
import { deliveryLabel } from "@/lib/shipping/rule";

// The delivery line of a summary (spec 0007, AC-4): "Standard delivery" with the fee, or
// "Free delivery" with "Free", the label from the one shipping rule module.
export function DeliveryRow({
  cents,
  currency,
}: {
  readonly cents: number;
  // Orders pass their own currency; the cart and checkout use the store's.
  readonly currency?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span>{deliveryLabel(cents)}</span>
      <span className="font-medium">
        {cents === 0 ? "Free" : <Price cents={cents} currency={currency} />}
      </span>
    </div>
  );
}
