import { ArrowLeftIcon, ExternalLinkIcon, SearchXIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DateFormat } from "@/lib/dates";

import type { CategoryOption, ProductForEdit, StockHistoryRow } from "../../admin-queries";
import { adminProductsPath, productPath } from "../../paths";
import type { StorageTarget } from "../image-upload";
import { CategoriesSection } from "./categories-section";
import { DeleteProductButton } from "./delete-product-button";
import { DetailsForm } from "./details-form";
import { ImagesSection } from "./images-section";
import { StatusCard } from "./status-card";
import { StockForm } from "./stock-form";
import { StockHistory } from "./stock-history";
import { VariantsForm } from "./variants-form";

function BackLink() {
  return (
    <Link
      href={adminProductsPath}
      className="flex items-center gap-1 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Products
    </Link>
  );
}

// spec 0009: the edit page, one form per section, each saved on its own with its own conflict
// check (AC-21). Each section is keyed by what it loaded, so a save that lands and refreshes
// the page remounts it with the stored values.
export function ProductEditor({
  product,
  stockHistory,
  dateFormat,
  storage,
  categories,
}: {
  readonly product: ProductForEdit;
  readonly categories: readonly CategoryOption[];
  readonly storage: StorageTarget;
  readonly stockHistory: readonly StockHistoryRow[];
  readonly dateFormat: DateFormat;
}) {
  const loadedAt = product.updatedAt.toISOString();
  // What each section loaded: a change to any of it remounts that section with the new values.
  const variantsKey = JSON.stringify([
    product.optionTypes,
    product.variants.map((variant) => [
      variant.id,
      variant.priceCents,
      variant.compareAtPriceCents,
      variant.sku,
      variant.archived,
    ]),
  ]);
  const stockRows = product.variants
    .filter((variant) => !variant.archived)
    .map((variant) => ({
      variantId: variant.id,
      label: variant.label,
      stock: variant.stockQuantity,
    }));
  const stockKey = JSON.stringify(stockRows);
  const imagesKey = JSON.stringify([product.images, product.optionTypes]);
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">{product.name}</h1>
            <p className="text-sm text-muted-foreground">
              Each section saves on its own. Changes reach the storefront on the next visit.
            </p>
          </div>
          {product.status === "active" ? (
            <Link
              href={productPath(product.slug)}
              target="_blank"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />
              View in store
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <DetailsForm key={loadedAt} product={{ ...product, updatedAt: loadedAt }} />
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Images</h2>
              </CardTitle>
              <CardDescription>
                Drag to reorder, or use a handle with the keyboard. An image can belong to one
                value, like the red photos of a tee; the product page shows those when that value is
                picked.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImagesSection
                key={imagesKey}
                productId={product.id}
                storage={storage}
                images={product.images}
                optionTypes={product.optionTypes}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Variants and prices</h2>
              </CardTitle>
              <CardDescription>
                {product.optionTypes.length > 0
                  ? "Rename options and values, add a value, and set each variant's price and SKU."
                  : "This product comes in one version. Set its price and SKU."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VariantsForm
                key={variantsKey}
                productId={product.id}
                slug={product.slug}
                status={product.status}
                optionTypes={product.optionTypes}
                variants={product.variants}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Stock</h2>
              </CardTitle>
              <CardDescription>
                Set what you counted. A sale while you type refuses the save instead of being
                undone.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-8">
              {stockRows.length > 0 ? (
                <StockForm key={stockKey} productId={product.id} rows={stockRows} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Every variant is archived. Restore one to set its stock.
                </p>
              )}
              <section aria-labelledby="stock-history-heading" className="flex flex-col gap-3">
                <h3 id="stock-history-heading" className="font-medium">
                  History
                </h3>
                <StockHistory rows={stockHistory} dateFormat={dateFormat} />
              </section>
            </CardContent>
          </Card>
        </div>
        {/* On phones the status comes first: it decides whether anything here is live. */}
        <div className="order-first flex min-w-0 flex-col gap-6 lg:sticky lg:top-20 lg:order-none">
          <StatusCard
            key={product.status}
            productId={product.id}
            status={product.status}
            deleteSlot={
              product.deletable ? (
                <DeleteProductButton productId={product.id} name={product.name} />
              ) : null
            }
          />
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Categories</h2>
              </CardTitle>
              <CardDescription>A product can sit in several categories.</CardDescription>
            </CardHeader>
            <CardContent>
              <CategoriesSection
                key={JSON.stringify([product.categoryIds, categories])}
                productId={product.id}
                categories={categories}
                categoryIds={product.categoryIds}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

// An unknown or malformed id: the panel's own not found state, inside the admin shell.
export function ProductNotFound() {
  return (
    <>
      <BackLink />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h1>Product not found</h1>
          </EmptyTitle>
          <EmptyDescription>There is no product at this address.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href={adminProductsPath} className={buttonVariants({ variant: "outline" })}>
            Back to products
          </Link>
        </EmptyContent>
      </Empty>
    </>
  );
}
