import "server-only";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/product-image-rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// spec 0009, AC-14: deletes the files of image rows already removed, after their transaction
// committed (Storage and Postgres share no rollback). A file an order line still points at
// stays, so that order keeps its photo; so does one another image row uses. A failed delete
// never fails the save: the file stays behind and the failure is logged.
export async function deleteUnreferencedImageFiles(
  paths: readonly string[],
  context: { readonly adminId: string; readonly productId: string },
): Promise<void> {
  if (paths.length === 0) return;
  const [ordered, kept] = await Promise.all([
    db.orderLine.findMany({
      where: { imagePath: { in: [...paths] } },
      select: { imagePath: true },
      distinct: ["imagePath"],
    }),
    db.productImage.findMany({
      where: { storagePath: { in: [...paths] } },
      select: { storagePath: true },
    }),
  ]);
  const referenced = new Set([
    ...ordered.flatMap((line) => (line.imagePath === null ? [] : [line.imagePath])),
    ...kept.map((image) => image.storagePath),
  ]);
  const unreferenced = paths.filter((path) => !referenced.has(path));
  if (unreferenced.length === 0) return;

  let failed = false;
  try {
    const { error } = await createSupabaseAdminClient()
      .storage.from(PRODUCT_IMAGE_BUCKET)
      .remove(unreferenced);
    failed = error !== null;
  } catch {
    failed = true;
  }
  if (failed) {
    const event = "catalog.images.file_delete_failed";
    // Paths are generated UUIDs, never customer or product text.
    logger.warn({ event, ...context, paths: unreferenced }, event);
  }
}

// The path pattern is checked by the schemas; this confirms the upload really happened.
export async function imageUploaded(path: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient()
    .storage.from(PRODUCT_IMAGE_BUCKET)
    .exists(path);
  return !error && data === true;
}

export const imageMissingMessage = "The image did not finish uploading. Choose it again.";
export const imageDuplicateMessage = "This image is already used. Choose it again.";

// The indexes of the new paths whose upload never landed.
export async function missingUploads(paths: readonly string[]): Promise<readonly number[]> {
  const landed = await Promise.all(paths.map((path) => imageUploaded(path)));
  return landed.flatMap((ok, index) => (ok ? [] : [index]));
}
