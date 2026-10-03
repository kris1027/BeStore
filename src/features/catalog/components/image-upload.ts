"use client";

import { createClient } from "@supabase/supabase-js";

import {
  isImageContentType,
  MAX_IMAGE_BYTES,
  PRODUCT_IMAGE_BUCKET,
} from "@/lib/product-image-rules";

import { createProductImageUpload } from "../actions/create-image-upload";

export type UploadedImage = {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  // A local object URL, for the preview only.
  readonly previewUrl: string;
};

export type StorageTarget = { readonly url: string; readonly anonKey: string };

const MAX_DIMENSION = 10_000;

export const uploadErrors = {
  unsupported_type: "Choose a PNG, JPEG, WebP or AVIF file.",
  too_large: "Choose a file of 10 MB or less.",
  unavailable: "The upload could not start. Try again.",
  unreadable: "This file could not be read as an image.",
  dimensions: `Choose an image up to ${MAX_DIMENSION} pixels wide and tall.`,
  failed: "The upload did not finish. Try again.",
} as const;

export type UploadError = keyof typeof uploadErrors;

// Checks the file, reads its size in pixels (layout hints only), asks the server for a one time
// upload token, and uploads the file straight to Storage (spec 0005, AC-5).
export async function uploadImage(
  file: File,
  storage: StorageTarget,
): Promise<{ ok: true; image: UploadedImage } | { ok: false; error: UploadError }> {
  if (!isImageContentType(file.type)) return { ok: false, error: "unsupported_type" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "too_large" };

  let width: number;
  let height: number;
  try {
    const bitmap = await createImageBitmap(file);
    ({ width, height } = bitmap);
    bitmap.close();
  } catch {
    return { ok: false, error: "unreadable" };
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return { ok: false, error: "dimensions" };

  const ticket = await createProductImageUpload({ contentType: file.type, size: file.size });
  if (!ticket.ok) return { ok: false, error: ticket.error };

  const client = createClient(storage.url, storage.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
  if (error) return { ok: false, error: "failed" };

  return {
    ok: true,
    image: { path: ticket.data.path, width, height, previewUrl: URL.createObjectURL(file) },
  };
}
