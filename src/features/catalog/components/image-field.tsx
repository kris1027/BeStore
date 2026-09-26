"use client";

import { createClient } from "@supabase/supabase-js";
import { ImageIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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

const uploadErrors = {
  unsupported_type: "Choose a PNG, JPEG, WebP or AVIF file.",
  too_large: "Choose a file of 10 MB or less.",
  unavailable: "The upload could not start. Try again.",
  unreadable: "This file could not be read as an image.",
  dimensions: `Choose an image up to ${MAX_DIMENSION} pixels wide and tall.`,
  failed: "The upload did not finish. Try again.",
} as const;

type UploadError = keyof typeof uploadErrors;

// Checks the file, reads its size in pixels (layout hints only), asks the server for a one time
// upload token, and uploads the file straight to Storage (spec 0005, AC-5).
async function uploadImage(
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

export function ImageField({
  storage,
  image,
  onImageChange,
  altInput,
  altError,
  imageError,
  disabled,
}: {
  readonly storage: StorageTarget;
  readonly image: UploadedImage | null;
  readonly onImageChange: (image: UploadedImage | null) => void;
  // The registered alt text input, owned by the product form.
  readonly altInput: UseFormRegisterReturn<"imageAlt">;
  readonly altError: string | undefined;
  // From the create action, e.g. an upload that never landed.
  readonly imageError: string | undefined;
  readonly disabled: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const url = image?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [image?.previewUrl]);

  const error = uploadError ?? imageError;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2>Image</h2>
        </CardTitle>
        <CardDescription>Optional. PNG, JPEG, WebP or AVIF, up to 10 MB.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {image ? (
          <>
            <div className="relative aspect-product overflow-hidden rounded-sm bg-muted">
              {/* A local preview of the file just chosen; next/image cannot load a blob URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.previewUrl} alt="" className="size-full object-cover" />
            </div>
            <Field data-invalid={altError ? true : undefined}>
              <FieldLabel htmlFor="imageAlt">Alt text</FieldLabel>
              <Input
                id="imageAlt"
                aria-invalid={altError ? true : undefined}
                aria-describedby={
                  altError ? "imageAlt-description imageAlt-error" : "imageAlt-description"
                }
                {...altInput}
              />
              <FieldDescription id="imageAlt-description">
                What the photo shows, for people who cannot see it.
              </FieldDescription>
              <FieldError id="imageAlt-error">{altError}</FieldError>
            </Field>
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={disabled}
              onClick={() => onImageChange(null)}
            >
              <XIcon data-icon="inline-start" aria-hidden="true" />
              Remove image
            </Button>
          </>
        ) : (
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="image">Photo</FieldLabel>
            <div className="flex aspect-product flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-input bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              {uploading ? (
                <p role="status" className="flex items-center gap-2">
                  <Spinner />
                  Uploading…
                </p>
              ) : (
                <>
                  <ImageIcon className="size-8" aria-hidden="true" />
                  No image yet
                </>
              )}
            </div>
            <Input
              id="image"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              disabled={disabled || uploading}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "image-error" : undefined}
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                setUploadError(null);
                setUploading(true);
                const result = await uploadImage(file, storage);
                setUploading(false);
                input.value = "";
                if (result.ok) onImageChange(result.image);
                else setUploadError(uploadErrors[result.error]);
              }}
            />
            <FieldError id="image-error">{error}</FieldError>
          </Field>
        )}
      </CardContent>
    </Card>
  );
}
