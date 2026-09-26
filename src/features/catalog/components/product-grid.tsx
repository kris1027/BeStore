import { StoreIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import { getActiveProducts } from "../queries";
import { ProductCard } from "./product-card";

// The first row loads eagerly: it is what a visitor sees without scrolling.
const EAGER_CARDS = 4;

export async function ProductGrid() {
  const products = await getActiveProducts();

  if (products.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <StoreIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h2>Nothing for sale just yet</h2>
          </EmptyTitle>
          <EmptyDescription>New products are on their way. Check back soon.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section aria-labelledby="products-heading" className="flex flex-col gap-6">
      <h2 id="products-heading" className="font-heading text-3xl">
        Shop all
      </h2>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
        {products.map((product, index) => (
          <ProductCard key={product.id} product={product} priority={index < EAGER_CARDS} />
        ))}
      </ul>
    </section>
  );
}
