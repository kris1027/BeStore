export type ImageCandidate = {
  readonly storagePath: string;
  readonly position: number;
  readonly optionValueId: string | null;
};

// The image an order line keeps (spec 0002, Value sourcing): the first image by position that
// belongs to one of the variant's option values, else the product's first image, else none.
export function orderLineImage(
  images: readonly ImageCandidate[],
  variantValueIds: readonly string[],
): string | null {
  const byPosition = images.toSorted((a, b) => a.position - b.position);
  const ownValue = byPosition.find(
    (image) => image.optionValueId !== null && variantValueIds.includes(image.optionValueId),
  );
  return (ownValue ?? byPosition[0])?.storagePath ?? null;
}
