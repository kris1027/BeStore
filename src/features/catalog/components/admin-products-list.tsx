import { PackageIcon, PlusIcon } from "lucide-react";
import Link from "next/link";

import { Price } from "@/components/price";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type DateFormat, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

import {
  ADMIN_PRODUCT_LIMIT,
  type AdminProductRow,
  type AdminProductsParams,
  type ProductListTab,
  productListTabs,
} from "../admin-queries";
import { adminProductPath, adminProductsPath, newProductPath } from "../paths";

export const statusLabels = { draft: "Draft", active: "Active", archived: "Archived" } as const;

const tabLabels: Record<ProductListTab, string> = {
  all: "All",
  active: "Active",
  draft: "Draft",
  archived: "Archived",
  featured: "Featured",
};

const tabEmpty: Record<ProductListTab, string> = {
  all: "No products to show",
  active: "No active products",
  draft: "No drafts",
  archived: "No archived products",
  featured: "No featured products",
};

function listHref(tab: ProductListTab): string {
  return tab === "all" ? adminProductsPath : `${adminProductsPath}?status=${tab}`;
}

function NewProductLink() {
  return (
    <Link href={newProductPath} className={buttonVariants()}>
      <PlusIcon data-icon="inline-start" aria-hidden="true" />
      New product
    </Link>
  );
}

// spec 0005, AC-1 and spec 0009, AC-1.
export function AdminProductsList({
  products,
  params,
  catalogEmpty,
  dateFormat,
}: {
  readonly products: readonly AdminProductRow[];
  readonly params: AdminProductsParams;
  // No product at all, in any status: the first run state.
  readonly catalogEmpty: boolean;
  readonly dateFormat: DateFormat;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="text-sm text-muted-foreground">
            Everything in the catalog, newest first. Active products show on the storefront.
          </p>
        </div>
        {catalogEmpty ? null : <NewProductLink />}
      </div>
      {catalogEmpty ? null : (
        <nav
          aria-label="Product views"
          className="flex flex-wrap gap-1 self-start rounded-md border p-1"
        >
          {productListTabs.map((tab) => (
            <Link
              key={tab}
              href={listHref(tab)}
              aria-current={params.tab === tab ? "page" : undefined}
              className={cn(
                buttonVariants({ variant: params.tab === tab ? "secondary" : "ghost", size: "sm" }),
                "aria-[current=page]:font-semibold",
              )}
            >
              {tabLabels[tab]}
            </Link>
          ))}
        </nav>
      )}
      {catalogEmpty ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>No products yet</h2>
            </EmptyTitle>
            <EmptyDescription>
              Add your first product with its price and stock. Save it as a draft, or publish it
              straight to the storefront.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewProductLink />
          </EmptyContent>
        </Empty>
      ) : products.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>{tabEmpty[params.tab]}</h2>
            </EmptyTitle>
            <EmptyDescription>Products with this status show here.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link href={adminProductsPath} className={buttonVariants({ variant: "outline" })}>
              Show all products
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Products" }}>
              <TableCaption className="sr-only">
                {tabLabels[params.tab]} products, newest first
                {products.length === ADMIN_PRODUCT_LIMIT
                  ? ` (the first ${ADMIN_PRODUCT_LIMIT})`
                  : ""}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Variants</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium whitespace-normal">
                      <Link
                        href={adminProductPath(product.id)}
                        className="underline-offset-4 hover:underline"
                      >
                        {product.name}
                      </Link>
                      <span className="block text-xs font-normal text-muted-foreground">
                        /products/{product.slug}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={product.status === "active" ? "secondary" : "outline"}>
                        {statusLabels[product.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {product.variantCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{product.totalStock}</TableCell>
                    <TableCell className="text-right">
                      <Price cents={product.minPriceCents} />
                      {product.maxPriceCents !== product.minPriceCents ? (
                        <>
                          {" to "}
                          <Price cents={product.maxPriceCents} />
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell>{formatDate(product.createdAt, dateFormat)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
