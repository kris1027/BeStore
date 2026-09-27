import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductImage } from "@/components/product-image";
import { Skeleton } from "@/components/ui/skeleton";

import { getProductBySlug } from "../queries";
import { ProductPurchase } from "./product-purchase";

const layout = "grid gap-8 md:grid-cols-2 md:gap-12 lg:gap-16";

// spec 0005, AC-7. A slug that is not an active product gets the branded 404 page; under Cache
// Components its status stays 200 with `noindex`, since the shell has already streamed.
export async function ProductDetails({ params }: { readonly params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  return (
    <div className={layout}>
      <ProductImage
        src={product.image.src}
        alt={product.image.alt}
        sizes="(min-width: 768px) 50vw, 100vw"
        priority
      />
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Link
            href="/"
            className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Shop all
          </Link>
          <h1 className="font-heading text-4xl text-balance md:text-5xl">{product.name}</h1>
        </div>
        <ProductPurchase optionTypes={product.optionTypes} variants={product.variants} />
        {product.description ? (
          <section aria-labelledby="description-heading" className="flex flex-col gap-2">
            <h2 id="description-heading" className="font-heading text-2xl">
              Description
            </h2>
            <p className="max-w-prose whitespace-pre-line text-muted-foreground">
              {product.description}
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function ProductDetailsSkeleton() {
  return (
    <div className={layout} aria-hidden="true">
      <Skeleton className="aspect-product w-full" />
      <div className="flex flex-col gap-6">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}
