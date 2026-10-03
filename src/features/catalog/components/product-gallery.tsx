"use client";

import Image from "next/image";
import { useState } from "react";

import { ProductImage } from "@/components/product-image";
import { PLACEHOLDER_IMAGE } from "@/lib/product-image-path";
import { cn } from "@/lib/utils";

import type { GalleryImage } from "../queries";

// spec 0009, AC-15: the main image and a row of thumbnail buttons, named by each image's alt
// text, the current one marked aria-current. The parent passes the images of the selected
// variant (galleryImages) and keys this by them, so a new pick starts on its first photo.
export function ProductGallery({ images }: { readonly images: readonly GalleryImage[] }) {
  const [current, setCurrent] = useState(0);
  const main = images[current] ?? images[0];

  return (
    <div className="flex flex-col gap-3">
      <ProductImage
        src={main?.src ?? PLACEHOLDER_IMAGE}
        alt={main?.alt ?? ""}
        sizes="(min-width: 768px) 50vw, 100vw"
        priority
      />
      {images.length > 1 ? (
        <ul aria-label="Product images" className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {images.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                aria-label={image.alt || `Image ${index + 1}`}
                aria-current={index === current ? "true" : undefined}
                onClick={() => setCurrent(index)}
                className={cn(
                  "relative block aspect-product w-full overflow-hidden rounded-sm bg-muted ring-offset-2 transition-opacity hover:opacity-90",
                  index === current ? "ring-2 ring-primary" : "opacity-80",
                )}
              >
                <Image src={image.src} alt="" fill sizes="96px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
