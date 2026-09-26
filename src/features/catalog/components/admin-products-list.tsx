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

import { ADMIN_PRODUCT_LIMIT, type AdminProductRow } from "../admin-queries";

export const newProductPath = "/admin/products/new";

const statusLabels = { draft: "Draft", active: "Active", archived: "Archived" } as const;

function NewProductLink() {
  return (
    <Link href={newProductPath} className={buttonVariants()}>
      <PlusIcon data-icon="inline-start" aria-hidden="true" />
      New product
    </Link>
  );
}

// spec 0005, AC-1.
export function AdminProductsList({
  products,
  dateFormat,
}: {
  readonly products: readonly AdminProductRow[];
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
        {products.length > 0 ? <NewProductLink /> : null}
      </div>
      {products.length === 0 ? (
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
        <Card>
          <CardContent>
            <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Products" }}>
              <TableCaption className="sr-only">
                Products, newest first
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
                      {product.name}
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
