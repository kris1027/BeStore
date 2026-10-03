import { ArrowLeftIcon, PackageIcon } from "lucide-react";
import Link from "next/link";

import { ArrangeList } from "@/components/arrange-list";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import type { ArrangeItem } from "../admin-queries";
import { reorderProducts } from "../actions/reorder-products";
import { HOME_PRODUCT_LIMIT } from "../queries";
import { adminProductsPath } from "../paths";

// spec 0009, AC-20: every active product in home grid order; each drop saves at once.
export function ArrangeProducts({ products }: { readonly products: readonly ArrangeItem[] }) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Link
          href={adminProductsPath}
          className="flex items-center gap-1 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Products
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Arrange products</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            The home page shows active products in this order, the first {HOME_PRODUCT_LIMIT} of
            them. Drag a product, or focus its handle and use Space and the arrow keys. Each move
            saves at once.
          </p>
        </div>
      </div>
      {products.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>No active products</h2>
            </EmptyTitle>
            <EmptyDescription>Publish a product and it shows here, first in line.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ArrangeList
          // Keyed by the set, not the order: a saved move re-renders the page in its new order, and
          // that must not remount the list (and lose its status); one added or removed must.
          key={products
            .map((product) => product.id)
            .toSorted()
            .join(",")}
          label="Active products, in home page order"
          items={products.map((product) => ({
            id: product.id,
            name: product.name,
            thumbnail: product.src,
          }))}
          save={reorderProducts}
        />
      )}
    </>
  );
}
