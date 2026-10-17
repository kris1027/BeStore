"use client";

import { XIcon } from "lucide-react";
import Link from "next/link";

import { SortableList } from "@/components/sortable-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { CategoryProduct } from "../admin-queries";
import { statusLabels } from "./product-status";

// spec 0013, AC-23: the category's products in their draft order, arranged by drag and drop or
// keyboard, each with Remove, and the Save order bar.
export function ArrangedProducts({
  products,
  disabled,
  saving,
  dirty,
  status,
  onReorder,
  onRemove,
  onSave,
}: {
  // In the draft order.
  readonly products: readonly CategoryProduct[];
  readonly disabled: boolean;
  readonly saving: boolean;
  readonly dirty: boolean;
  // The last save's outcome, shown when nothing is unsaved.
  readonly status: string | null;
  readonly onReorder: (ids: readonly string[]) => void;
  readonly onRemove: (product: CategoryProduct) => void;
  readonly onSave: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        The category page shows its products in this order. Drag a product, or focus its handle and
        use Space and the arrow keys, then save the order.
      </p>
      <SortableList
        label="Products in this category"
        items={products}
        disabled={disabled}
        onReorder={onReorder}
        renderItem={(product, handle, index) => (
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-2 pr-3">
            {handle}
            <span className="w-6 text-right text-sm text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <Link
              href={`/admin/products/${product.id}`}
              className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline"
            >
              {product.name}
            </Link>
            <Badge variant={product.status === "active" ? "secondary" : "outline"}>
              {statusLabels[product.status]}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onRemove(product)}
            >
              <XIcon data-icon="inline-start" aria-hidden="true" />
              Remove<span className="sr-only"> {product.name}</span>
            </Button>
          </div>
        )}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={!dirty || disabled} onClick={onSave}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Save order
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {dirty ? "Unsaved order." : status}
        </p>
      </div>
    </div>
  );
}
