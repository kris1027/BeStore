import type { Metadata } from "next";
import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import {
  ProductDetails,
  ProductDetailsSkeleton,
} from "@/features/catalog/components/product-details";
import { getPrerenderedSlugs, getProductBySlug } from "@/features/catalog/queries";
import { cn } from "@/lib/utils";

// Cannot match the slug pattern, so it renders the 404 page. Cache Components refuses an empty
// list, and an empty catalog (a fresh build) has no slugs to give.
const NO_PRODUCT_SLUG = "__none__";

export async function generateStaticParams() {
  const slugs = await getPrerenderedSlugs();
  return slugs.length > 0 ? slugs.map((slug) => ({ slug })) : [{ slug: NO_PRODUCT_SLUG }];
}

export async function generateMetadata({
  params,
}: PageProps<"/products/[slug]">): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  return product ? { title: product.name } : { title: "Page not found" };
}

// Other slugs render on their first visit and are cached (spec 0005, Caching model).
export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <div className={cn(storeContainer, "py-8 md:py-12")}>
      <Suspense fallback={<ProductDetailsSkeleton />}>
        <ProductDetails params={params} />
      </Suspense>
    </div>
  );
}
