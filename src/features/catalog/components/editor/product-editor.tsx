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

import type { ProductForEdit } from "../../admin-queries";
import { adminProductsPath, productPath } from "../../paths";
import { DetailsForm } from "./details-form";
import { StatusCard } from "./status-card";

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
export function ProductEditor({ product }: { readonly product: ProductForEdit }) {
  const loadedAt = product.updatedAt.toISOString();
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
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20">
          <StatusCard key={product.status} productId={product.id} status={product.status} />
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
