import type { Availability } from "@/lib/availability";

// Pure rules of the product page picker (spec 0005, AC-7).

type PickerVariant = {
  readonly id: string;
  readonly availability: Availability;
  readonly optionValueIds: readonly string[];
};

// One option value id per option type, in option type order.
export type Selection = readonly string[];

const inStock = (variant: PickerVariant) => variant.availability.kind !== "sold_out";

// The first in stock variant by position, else the first variant.
export function initialVariant<V extends PickerVariant>(variants: readonly V[]): V | undefined {
  return variants.find(inStock) ?? variants[0];
}

export function variantFor<V extends PickerVariant>(
  variants: readonly V[],
  selection: Selection,
): V | undefined {
  return variants.find(
    (variant) =>
      variant.optionValueIds.length === selection.length &&
      variant.optionValueIds.every((id, t) => id === selection[t]),
  );
}

// A value stays pickable while at least one in stock variant has it. Judging it on its own,
// not against the other current picks, means no pick can ever trap the customer: any in stock
// combination is reachable from any other.
export function isValueAvailable(
  variants: readonly PickerVariant[],
  typeIndex: number,
  valueId: string,
): boolean {
  return variants.some(
    (variant) => inStock(variant) && variant.optionValueIds[typeIndex] === valueId,
  );
}

export function withValue(selection: Selection, typeIndex: number, valueId: string): Selection {
  return selection.map((id, t) => (t === typeIndex ? valueId : id));
}
