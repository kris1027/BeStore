import { ArrowLeftIcon, SearchIcon, SearchXIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

import type { CategoryForEdit, CategoryProduct } from "../admin-queries";
import { adminCategoriesPath, adminCategoryPath } from "../paths";
import { CategoryForm } from "./category-form";
import { CategoryProducts } from "./category-products";
import { DeleteCategoryButton } from "./delete-category-button";

function BackLink() {
  return (
    <Link
      href={adminCategoriesPath}
      className="flex items-center gap-1 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Categories
    </Link>
  );
}

export function NewCategoryPage() {
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink />
        <h1 className="text-2xl font-semibold">New category</h1>
      </div>
      <Card className="max-w-2xl">
        <CardContent>
          <CategoryForm />
        </CardContent>
      </Card>
    </>
  );
}

// spec 0009, AC-17 to AC-19: the category's fields, its products and the delete button.
export function CategoryEditor({
  category,
  results,
  searched,
  searchMaxLength,
}: {
  readonly category: CategoryForEdit;
  readonly results: readonly CategoryProduct[] | null;
  readonly searched: string;
  readonly searchMaxLength: number;
}) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{category.name}</h1>
          {category.visible ? null : <Badge variant="outline">Hidden</Badge>}
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Details</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryForm
                key={category.updatedAt.toISOString()}
                category={{ ...category, updatedAt: category.updatedAt.toISOString() }}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Products</h2>
              </CardTitle>
              <CardDescription>
                Products join at the end of the category. Find one by name or SKU to add it.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <form
                aria-label="Find products to add"
                action={adminCategoryPath(category.id)}
                className="flex flex-wrap items-end gap-3"
              >
                <div className="flex min-w-48 flex-1 flex-col gap-2 sm:max-w-sm">
                  <Label htmlFor="category-search">Add products</Label>
                  <Input
                    id="category-search"
                    type="search"
                    name="q"
                    defaultValue={searched}
                    maxLength={searchMaxLength}
                    autoComplete="off"
                  />
                </div>
                <Button type="submit" variant="outline">
                  <SearchIcon data-icon="inline-start" aria-hidden="true" />
                  Find
                </Button>
              </form>
              <CategoryProducts
                categoryId={category.id}
                products={category.products}
                results={results}
                searched={searched}
              />
            </CardContent>
          </Card>
        </div>
        <Card className="order-first lg:order-none">
          <CardHeader>
            <CardTitle>
              <h2>Delete</h2>
            </CardTitle>
            <CardDescription>Removes the category; its products stay.</CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteCategoryButton
              categoryId={category.id}
              name={category.name}
              productCount={category.products.length}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// An unknown or malformed id: the panel's own not found state (AC-17).
export function CategoryNotFound() {
  return (
    <>
      <BackLink />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h1>Category not found</h1>
          </EmptyTitle>
          <EmptyDescription>There is no category at this address.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href={adminCategoriesPath} className={buttonVariants({ variant: "outline" })}>
            Back to categories
          </Link>
        </EmptyContent>
      </Empty>
    </>
  );
}
