import { ArrowDownUpIcon, PackageIcon, PlusIcon, SearchIcon } from "lucide-react";
import Link from "next/link";

import { Price } from "@/components/price";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type AdminProductsPage,
  type AdminProductsParams,
  type CategoryOption,
  type ProductListTab,
  productListTabs,
  SEARCH_MAX_LENGTH,
} from "../admin-queries";
import { adminProductPath, adminProductsPath, arrangeProductsPath, newProductPath } from "../paths";
import { CategoryFilter } from "./category-filter";

export const statusLabels = { draft: "Draft", active: "Active", archived: "Archived" } as const;

const tabLabels: Record<ProductListTab, string> = {
  all: "All",
  active: "Active",
  draft: "Draft",
  archived: "Archived",
  featured: "Featured",
};

// The list's URL for a set of filters; every filter lives there (spec 0009, AC-1).
export function productsListHref(
  params: Pick<AdminProductsParams, "tab" | "q" | "categoryId"> & {
    readonly before?: string | null;
  },
): string {
  const query = new URLSearchParams();
  if (params.tab === "featured") query.set("featured", "1");
  else if (params.tab !== "all") query.set("status", params.tab);
  if (params.q !== "") query.set("q", params.q);
  if (params.categoryId !== null) query.set("category", params.categoryId);
  if (params.before) query.set("before", params.before);
  const search = query.toString();
  return search ? `${adminProductsPath}?${search}` : adminProductsPath;
}

function NewProductLink() {
  return (
    <Link href={newProductPath} className={buttonVariants()}>
      <PlusIcon data-icon="inline-start" aria-hidden="true" />
      New product
    </Link>
  );
}

// What the empty state says was asked for, so "Clear filters" is a clear way out.
function filterSummary(params: AdminProductsParams, categoryName: string | null): string {
  const parts = [
    params.tab === "all" ? null : `${tabLabels[params.tab]} products`,
    params.q === "" ? null : `matching "${params.q}"`,
    categoryName === null ? null : `in ${categoryName}`,
  ].filter(Boolean);
  return parts.length === 0 ? "No products to show" : `No ${parts.join(", ")}`;
}

// spec 0005, AC-1 and spec 0009, AC-1.
export function AdminProductsList({
  page,
  params,
  categories,
  catalogEmpty,
  dateFormat,
}: {
  readonly page: AdminProductsPage;
  readonly params: AdminProductsParams;
  readonly categories: readonly CategoryOption[];
  // No product at all, in any status: the first run state.
  readonly catalogEmpty: boolean;
  readonly dateFormat: DateFormat;
}) {
  const { rows, nextBefore } = page;
  const categoryName = categories.find((category) => category.id === params.categoryId)?.name;
  const filtered = params.tab !== "all" || params.q !== "" || params.categoryId !== null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="text-sm text-muted-foreground">
            Everything in the catalog, newest first. Active products show on the storefront.
          </p>
        </div>
        {catalogEmpty ? null : (
          <div className="flex flex-wrap gap-2">
            <Link href={arrangeProductsPath} className={buttonVariants({ variant: "outline" })}>
              <ArrowDownUpIcon data-icon="inline-start" aria-hidden="true" />
              Arrange
            </Link>
            <NewProductLink />
          </div>
        )}
      </div>

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
      ) : (
        <>
          <nav
            aria-label="Product views"
            className="flex flex-wrap gap-1 self-start rounded-md border p-1"
          >
            {productListTabs.map((tab) => (
              <Link
                key={tab}
                href={productsListHref({ ...params, tab })}
                aria-current={params.tab === tab ? "page" : undefined}
                className={cn(
                  buttonVariants({
                    variant: params.tab === tab ? "secondary" : "ghost",
                    size: "sm",
                  }),
                  "aria-[current=page]:font-semibold",
                )}
              >
                {tabLabels[tab]}
              </Link>
            ))}
          </nav>

          <form
            aria-label="Search products"
            action={adminProductsPath}
            className="flex flex-wrap items-end gap-3"
          >
            {params.tab === "featured" ? <input type="hidden" name="featured" value="1" /> : null}
            {params.tab !== "all" && params.tab !== "featured" ? (
              <input type="hidden" name="status" value={params.tab} />
            ) : null}
            <div className="flex min-w-48 flex-1 flex-col gap-2 sm:max-w-sm">
              <Label htmlFor="products-q">Name or SKU</Label>
              <Input
                id="products-q"
                type="search"
                name="q"
                defaultValue={params.q}
                maxLength={SEARCH_MAX_LENGTH}
                autoComplete="off"
              />
            </div>
            {categories.length > 0 ? (
              <CategoryFilter categories={categories} value={params.categoryId} />
            ) : null}
            <Button type="submit" variant="outline">
              <SearchIcon data-icon="inline-start" aria-hidden="true" />
              Search
            </Button>
          </form>

          {rows.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageIcon aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>
                  <h2>
                    {params.before !== null
                      ? "No more products"
                      : filterSummary(params, categoryName ?? null)}
                  </h2>
                </EmptyTitle>
                <EmptyDescription>
                  {filtered
                    ? "Try another search, or clear the filters to see every draft and active product."
                    : "Products you add show here."}
                </EmptyDescription>
              </EmptyHeader>
              {filtered || params.before !== null ? (
                <EmptyContent>
                  <Link href={adminProductsPath} className={buttonVariants({ variant: "outline" })}>
                    Clear filters
                  </Link>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <Card>
              <CardContent>
                <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Products" }}>
                  <TableCaption className="sr-only">
                    {tabLabels[params.tab]} products, newest first
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
                    {rows.map((product) => (
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
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={product.status === "active" ? "secondary" : "outline"}>
                              {statusLabels[product.status]}
                            </Badge>
                            {product.featured ? <Badge variant="outline">Featured</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {product.variantCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {product.totalStock}
                        </TableCell>
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

          {params.before !== null || nextBefore !== null ? (
            <nav aria-label="Pages" className="flex justify-between gap-2">
              {params.before !== null ? (
                <Link
                  href={productsListHref({ ...params, before: null })}
                  className={buttonVariants({ variant: "outline" })}
                >
                  First page
                </Link>
              ) : (
                <span />
              )}
              {nextBefore !== null ? (
                <Link
                  href={productsListHref({ ...params, before: nextBefore })}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Next page
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
