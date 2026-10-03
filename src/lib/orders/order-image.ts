import { galleryImages } from "@/lib/product-gallery";

export type ImageCandidate = {
  readonly storagePath: string;
  readonly position: number;
  readonly optionValueId: string | null;
};

// The image an order line keeps: the first photo of the product page gallery for this variant
// (spec 0009, AC-15), or none. Never another value's photo, so an order of the blue tee never
// shows the red one.
export function orderLineImage(
  images: readonly ImageCandidate[],
  variantValueIds: readonly string[],
): string | null {
  return galleryImages(images, variantValueIds)[0]?.storagePath ?? null;
}
