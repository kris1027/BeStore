// Pure rules for product image uploads (spec 0005, AC-5); the bucket enforces the same limits
// (supabase/config.toml), and the create action checks them again.

export const PRODUCT_IMAGE_BUCKET = "product-images";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const IMAGE_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
} as const;

export type ImageContentType = keyof typeof IMAGE_EXTENSIONS;

export const IMAGE_CONTENT_TYPES = Object.keys(IMAGE_EXTENSIONS) as ImageContentType[];

// Only paths the upload action hands out: products/<uuid v7>.<ext>.
export const PRODUCT_IMAGE_PATH =
  /^products\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|avif)$/;

// Own keys only: `in` would also accept inherited names such as "toString" or "__proto__".
export function isImageContentType(value: unknown): value is ImageContentType {
  return typeof value === "string" && Object.hasOwn(IMAGE_EXTENSIONS, value);
}
