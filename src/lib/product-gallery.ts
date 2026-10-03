// The one rule for which photos belong to a variant (spec 0009, AC-15): the images tied to one
// of the variant's option values first, then the images tied to no value, each group by
// position; images tied to other values are left out. The product page gallery and the order
// line photo (order_lines.image_path) both use it, so an order keeps the photo the customer saw.

export type GalleryCandidate = {
  readonly position: number;
  readonly optionValueId: string | null;
};

export function galleryImages<I extends GalleryCandidate>(
  images: readonly I[],
  selectedValueIds: readonly string[],
): readonly I[] {
  const byPosition = images.toSorted((a, b) => a.position - b.position);
  const tied = byPosition.filter(
    (image) => image.optionValueId !== null && selectedValueIds.includes(image.optionValueId),
  );
  const untied = byPosition.filter((image) => image.optionValueId === null);
  return [...tied, ...untied];
}
