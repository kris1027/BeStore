type LabelledValue = { readonly value: string; readonly typePosition: number };

// A variant's option values in option type order, joined with " / " ("M / Navy"); null for a
// default variant. Order line snapshots (spec 0002) use the same rule.
export function variantLabel(values: readonly LabelledValue[]): string | null {
  if (values.length === 0) return null;
  return [...values]
    .sort((a, b) => a.typePosition - b.typePosition)
    .map((entry) => entry.value)
    .join(" / ");
}
