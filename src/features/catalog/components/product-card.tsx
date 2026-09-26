import Link from "next/link";

import { Price } from "@/components/price";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";

import type { ProductCard as ProductCardData } from "../queries";

export function productPath(slug: string): string {
  return `/products/${slug}`;
}

// spec 0005, AC-6: image, name, price ("From" when variant prices differ), and Sold out.
export function ProductCard({
  product,
  priority,
}: {
  readonly product: ProductCardData;
  readonly priority?: boolean;
}) {
  const hasRange = product.maxPriceCents !== product.minPriceCents;
  return (
    <li>
      <Link href={productPath(product.slug)} className="group flex flex-col gap-3 rounded-sm">
        <div className="relative">
          <ProductImage
            src={product.image.src}
            alt={product.image.alt}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            priority={priority}
            className="transition-opacity group-hover:opacity-90"
          />
          {product.soldOut ? (
            <Badge variant="secondary" className="absolute top-2 left-2">
              Sold out
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-medium underline-offset-4 group-hover:underline">
            {product.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {hasRange ? "From " : null}
            <Price cents={product.minPriceCents} />
          </p>
        </div>
      </Link>
    </li>
  );
}
