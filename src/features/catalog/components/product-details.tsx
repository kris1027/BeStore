import Link from "next/link";
import { notFound } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";

import { ProductDescription } from "../markdown";
import { getProductBySlug } from "../queries";
import { productLayout, ProductShowcase } from "./product-showcase";

// spec 0005, AC-7. A slug that is not an active product gets the branded 404 page; under Cache
// Components its status stays 200 with `noindex`, since the shell has already streamed.
export async function ProductDetails({ params }: { readonly params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  return (
    <ProductShowcase
      images={product.images}
      optionTypes={product.optionTypes}
      variants={product.variants}
      header={
        <div className="flex flex-col gap-3">
          <Link
            href="/"
            className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Shop all
          </Link>
          <h1 className="font-heading text-4xl text-balance md:text-5xl">{product.name}</h1>
        </div>
      }
      description={
        product.description ? (
          <section aria-labelledby="description-heading" className="flex flex-col gap-3">
            <h2 id="description-heading" className="font-heading text-2xl">
              Description
            </h2>
            <ProductDescription markdown={product.description} />
          </section>
        ) : null
      }
    />
  );
}

export function ProductDetailsSkeleton() {
  return (
    <div className={productLayout} aria-hidden="true">
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
