import { FolderTreeIcon, PlusIcon } from "lucide-react";
import Link from "next/link";

import { ArrangeList } from "@/components/arrange-list";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import { reorderCategories } from "../actions/reorder-categories";
import type { AdminCategoryRow } from "../admin-queries";
import { adminCategoryPath, newCategoryPath } from "../paths";

function NewCategoryLink() {
  return (
    <Link href={newCategoryPath} className={buttonVariants()}>
      <PlusIcon data-icon="inline-start" aria-hidden="true" />
      New category
    </Link>
  );
}

// spec 0009, AC-17 and AC-20: every category in order, with its product count and a Hidden
// badge; drag (or keyboard) to reorder, each drop saving at once.
export function CategoriesPage({
  categories,
}: {
  readonly categories: readonly AdminCategoryRow[];
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Group products for shoppers. Drag a category, or focus its handle and use Space and the
            arrow keys, to set the order. Each move saves at once.
          </p>
        </div>
        {categories.length > 0 ? <NewCategoryLink /> : null}
      </div>
      {categories.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderTreeIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>No categories yet</h2>
            </EmptyTitle>
            <EmptyDescription>
              Add a category, then put products in it from here or from each product.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewCategoryLink />
          </EmptyContent>
        </Empty>
      ) : (
        <ArrangeList
          // Keyed by the set, not the order: a saved move re-renders the page in its new order, and
          // that must not remount the list (and lose its status); one added or removed must.
          key={categories
            .map((category) => category.id)
            .toSorted()
            .join(",")}
          label="Categories, in display order"
          items={categories.map((category) => ({
            id: category.id,
            name: category.name,
            href: adminCategoryPath(category.id),
            detail: (
              <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
                {category.visible ? null : <Badge variant="outline">Hidden</Badge>}
                <span className="tabular-nums">
                  {category.productCount} {category.productCount === 1 ? "product" : "products"}
                </span>
              </span>
            ),
          }))}
          save={reorderCategories}
        />
      )}
    </>
  );
}
