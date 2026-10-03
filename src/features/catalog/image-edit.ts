// Pure rule of the Images section (spec 0009, AC-21): a save is refused when the stored images
// differ from the ones the page loaded in id set, alt text, position or option link, or when it
// keeps an image that is gone.

export type ImageState = {
  readonly id: string;
  readonly altText: string;
  readonly position: number;
  readonly optionValueId: string | null;
};

export function imagesStale(
  loaded: readonly ImageState[],
  stored: readonly ImageState[],
  submitted: readonly { readonly id?: string | undefined }[],
): boolean {
  if (loaded.length !== stored.length) return true;
  const byId = new Map(stored.map((image) => [image.id, image]));
  const changed = loaded.some((image) => {
    const now = byId.get(image.id);
    return (
      now === undefined ||
      now.altText !== image.altText ||
      now.position !== image.position ||
      now.optionValueId !== image.optionValueId
    );
  });
  if (changed) return true;
  return submitted.some((image) => image.id !== undefined && !byId.has(image.id));
}
