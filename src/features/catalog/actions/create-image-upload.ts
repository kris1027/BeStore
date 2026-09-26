"use server";

import { z } from "zod";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, PRODUCT_IMAGE_BUCKET } from "@/lib/product-image";
import type { ActionResult } from "@/lib/result";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { uuidv7 } from "@/lib/uuid";

export type ImageUploadError = "unsupported_type" | "too_large" | "unavailable";

const uploadSchema = z.object({
  contentType: z.string(),
  size: z.number().int().positive(),
});

// spec 0005, AC-5: a fresh path the browser uploads straight to, with a token only an admin
// gets. `upsert: false`, so the token can never overwrite an existing object.
export async function createProductImageUpload(
  input: unknown,
): Promise<ActionResult<{ readonly path: string; readonly token: string }, ImageUploadError>> {
  await requireAdmin();

  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "unsupported_type" };
  const { contentType, size } = parsed.data;
  if (!(contentType in IMAGE_EXTENSIONS)) return { ok: false, error: "unsupported_type" };
  if (size > MAX_IMAGE_BYTES) return { ok: false, error: "too_large" };

  const extension = IMAGE_EXTENSIONS[contentType as keyof typeof IMAGE_EXTENSIONS];
  const path = `products/${uuidv7()}.${extension}`;
  const { data, error } = await createSupabaseAdminClient()
    .storage.from(PRODUCT_IMAGE_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });
  if (error) return { ok: false, error: "unavailable" };
  return { ok: true, data: { path: data.path, token: data.token } };
}
