"use client";

import { useState } from "react";

import { galleryImages } from "@/lib/product-gallery";

import { initialVariant, type Selection } from "../picker";
import type { GalleryImage, ProductOptionTypeView, ProductVariantView } from "../queries";
import { ProductGallery } from "./product-gallery";
import { ProductPurchase } from "./product-purchase";

export const productLayout = "grid gap-8 md:grid-cols-2 md:gap-12 lg:gap-16";

// The product page's interactive part: the picker's selection drives both the price and the
// gallery (spec 0009, AC-15). The heading and description render on the server and come in as
// children, so the Markdown never ships to the browser.
export function ProductShowcase({
  images,
  optionTypes,
  variants,
  header,
  description,
}: {
  readonly images: readonly GalleryImage[];
  readonly optionTypes: readonly ProductOptionTypeView[];
  readonly variants: readonly ProductVariantView[];
  readonly header: React.ReactNode;
  readonly description: React.ReactNode;
}) {
  const [selection, setSelection] = useState<Selection>(
    () => initialVariant(variants)?.optionValueIds ?? [],
  );
  const shown = galleryImages(images, selection);

  return (
    <div className={productLayout}>
      <ProductGallery key={shown.map((image) => image.id).join(",")} images={shown} />
      <div className="flex flex-col gap-8">
        {header}
        <ProductPurchase
          optionTypes={optionTypes}
          variants={variants}
          selection={selection}
          onSelectionChange={setSelection}
        />
        {description}
      </div>
    </div>
  );
}
