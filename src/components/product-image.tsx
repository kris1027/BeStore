import Image from "next/image";

import { PLACEHOLDER_IMAGE } from "@/lib/product-image-path";
import { cn } from "@/lib/utils";

type ProductImageProps = {
  readonly src: string;
  readonly alt: string;
  // Tells the browser which width to fetch at each breakpoint.
  readonly sizes: string;
  readonly priority?: boolean;
  readonly className?: string;
};

// Every product picture sits in the 4:5 box (docs/design.md), cropped to fill it.
export function ProductImage({ src, alt, sizes, priority, className }: ProductImageProps) {
  return (
    <div className={cn("relative aspect-product overflow-hidden rounded-sm bg-muted", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        // The placeholder is an SVG, which the optimizer refuses; it needs no resizing anyway.
        unoptimized={src === PLACEHOLDER_IMAGE}
        className="object-cover"
      />
    </div>
  );
}
