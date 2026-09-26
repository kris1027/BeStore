import { env } from "@/lib/env";

import { PRODUCT_IMAGE_BUCKET } from "./product-image-rules";

export { PLACEHOLDER_IMAGE } from "./product-image-path";
export * from "./product-image-rules";

// The bucket is public for reads (spec 0001), so an image is a plain URL, never a signed one.
export function productImageUrl(storagePath: string): string {
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${storagePath}`;
}
