"use client";

import { ImageIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { SortableList } from "@/components/sortable-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

import { MAX_IMAGES } from "../schemas";
import { type StorageTarget, uploadErrors, uploadImage } from "./image-upload";

export type ImageDraft = {
  // Stable while the list is edited: the stored id, or the fresh upload's path.
  readonly key: string;
  readonly id: string | null;
  readonly path: string | null;
  // A public URL for a stored image, a local object URL for a fresh one.
  readonly src: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly altText: string;
  // "" for an image of every variant, else one of the choices' keys.
  readonly optionKey: string;
};

export type OptionChoice = { readonly key: string; readonly label: string };

const noOption = "";

// spec 0009, AC-13: up to 8 images, each with alt text and optionally one option value, in
// an order set by drag and drop or the keyboard. Controlled: the create form and the Images
// section own the list and send it. Errors are keyed by dotted path ("images.2.altText").
export function ImagesEditor({
  idPrefix,
  storage,
  images,
  onChange,
  choices,
  errors,
  disabled,
}: {
  readonly idPrefix: string;
  readonly storage: StorageTarget;
  readonly images: readonly ImageDraft[];
  readonly onChange: (images: readonly ImageDraft[]) => void;
  readonly choices: readonly OptionChoice[];
  readonly errors: Readonly<Record<string, string>>;
  readonly disabled: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const full = images.length >= MAX_IMAGES;
  const items = [
    { value: noOption, label: "Every variant" },
    ...choices.map((choice) => ({
      value: choice.key,
      label: choice.label,
    })),
  ];

  function update(key: string, change: Partial<ImageDraft>) {
    onChange(images.map((image) => (image.key === key ? { ...image, ...change } : image)));
  }

  function remove(image: ImageDraft) {
    if (image.path !== null && image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
    onChange(images.filter((entry) => entry.key !== image.key));
  }

  const listError = errors.images;
  const addId = `${idPrefix}-add`;

  return (
    <div className="flex flex-col gap-4">
      {images.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-input bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          <ImageIcon className="size-8" aria-hidden="true" />
          No images yet. The storefront shows a plain placeholder.
        </div>
      ) : (
        <SortableList
          label="Images, in display order"
          items={images.map((image) => ({
            ...image,
            id: image.key,
            // Never the position: it changes during the drag that announces it.
            name: image.altText.trim() ? `image ${image.altText.trim()}` : "image without alt text",
          }))}
          disabled={disabled}
          onReorder={(keys) =>
            onChange(
              keys.flatMap((key) => {
                const image = images.find((entry) => entry.key === key);
                return image ? [image] : [];
              }),
            )
          }
          renderItem={(item, handle, index) => {
            const image = images[index] ?? item;
            const base = `${idPrefix}-${index}`;
            const altError = errors[`images.${index}.altText`];
            const optionError =
              errors[`images.${index}.optionValueId`] ?? errors[`images.${index}.optionValue`];
            const imageError = errors[`images.${index}`];
            return (
              <div className="flex gap-3 rounded-md border bg-card p-3">
                <div className="flex flex-col items-center gap-2">{handle}</div>
                <div className="relative aspect-product w-16 shrink-0 overflow-hidden rounded-sm bg-muted sm:w-20">
                  {/* A stored image or a local preview; next/image cannot load a blob URL. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.src} alt="" className="size-full object-cover" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      Image {index + 1}
                      {index === 0 ? (
                        <Badge variant="secondary" className="ml-2">
                          Card image
                        </Badge>
                      ) : null}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => remove(image)}
                    >
                      <XIcon data-icon="inline-start" aria-hidden="true" />
                      Remove<span className="sr-only"> image {index + 1}</span>
                    </Button>
                  </div>
                  {imageError ? (
                    <p id={`${base}-error`} role="alert" className="text-sm text-destructive">
                      {imageError}
                    </p>
                  ) : null}
                  <Field data-invalid={altError ? true : undefined}>
                    <FieldLabel htmlFor={`${base}-alt`}>Alt text for image {index + 1}</FieldLabel>
                    <Input
                      id={`${base}-alt`}
                      value={image.altText}
                      disabled={disabled}
                      aria-invalid={altError ? true : undefined}
                      aria-describedby={altError ? `${base}-alt-error` : `${base}-alt-description`}
                      onChange={(event) => update(image.key, { altText: event.target.value })}
                    />
                    {altError ? (
                      <FieldError id={`${base}-alt-error`}>{altError}</FieldError>
                    ) : (
                      <FieldDescription id={`${base}-alt-description`}>
                        What the photo shows, for people who cannot see it.
                      </FieldDescription>
                    )}
                  </Field>
                  {choices.length > 0 ? (
                    <Field data-invalid={optionError ? true : undefined}>
                      <FieldLabel htmlFor={`${base}-option`}>Image {index + 1} shows</FieldLabel>
                      <Select
                        items={items}
                        value={image.optionKey}
                        disabled={disabled}
                        onValueChange={(value) =>
                          update(image.key, {
                            optionKey: typeof value === "string" ? value : noOption,
                          })
                        }
                      >
                        <SelectTrigger
                          id={`${base}-option`}
                          className="w-full sm:w-64"
                          aria-invalid={optionError ? true : undefined}
                          aria-describedby={optionError ? `${base}-option-error` : undefined}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {items.map((entry) => (
                              <SelectItem key={entry.value} value={entry.value}>
                                {entry.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldError id={`${base}-option-error`}>{optionError}</FieldError>
                    </Field>
                  ) : null}
                </div>
              </div>
            );
          }}
        />
      )}

      {listError ? (
        <p role="alert" className="text-sm text-destructive">
          {listError}
        </p>
      ) : null}

      <Field data-invalid={uploadError ? true : undefined}>
        <FieldLabel htmlFor={addId}>Add an image</FieldLabel>
        <Input
          id={addId}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          disabled={disabled || uploading || full}
          aria-invalid={uploadError ? true : undefined}
          aria-describedby={`${addId}-description${uploadError ? ` ${addId}-error` : ""}`}
          onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            setUploadError(null);
            setUploading(true);
            // A thrown action or fetch (e.g. offline) must not leave the input disabled.
            try {
              const result = await uploadImage(file, storage);
              if (result.ok) {
                onChange([
                  ...images,
                  {
                    key: result.image.path,
                    id: null,
                    path: result.image.path,
                    src: result.image.previewUrl,
                    width: result.image.width,
                    height: result.image.height,
                    altText: "",
                    optionKey: noOption,
                  },
                ]);
              } else {
                setUploadError(uploadErrors[result.error]);
              }
            } catch {
              setUploadError(uploadErrors.failed);
            } finally {
              setUploading(false);
              input.value = "";
            }
          }}
        />
        <FieldDescription id={`${addId}-description`}>
          {full
            ? `This product has the most images it can hold (${MAX_IMAGES}). Remove one to add another.`
            : `PNG, JPEG, WebP or AVIF, up to 10 MB. Up to ${MAX_IMAGES} images; the first is the card image.`}
        </FieldDescription>
        {uploading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Uploading…
          </p>
        ) : null}
        <FieldError id={`${addId}-error`}>{uploadError}</FieldError>
      </Field>
    </div>
  );
}
