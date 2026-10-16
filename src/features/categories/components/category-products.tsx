"use client";

import { PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormNotice } from "@/components/form-notice";
import { SortableList } from "@/components/sortable-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";

import { reorderCategoryProducts } from "../actions/reorder-category-products";
import { setCategoryProducts } from "../actions/set-category-products";
import type { CategoryProduct } from "../admin-queries";

const statusLabels = { draft: "Draft", active: "Active", archived: "Archived" } as const;

const errorMessages = {
  unknown_product: "That product was deleted meanwhile. Search again.",
  not_found: "This category no longer exists. Go back to the categories.",
} as const;

const staleOrderMessage =
  "The products in this category changed meanwhile, so the order was not saved. Here is the current list.";

function productHref(id: string) {
  return `/admin/products/${id}`;
}

type Change = {
  readonly productId: string;
  readonly action: "add" | "remove";
  readonly name: string;
};

// spec 0009, AC-18: the category's products with Remove buttons, and the "Add products" search
// results with Add buttons. The search itself is a plain GET form on the page.
// spec 0013, AC-23: the list is arranged by drag and drop or keyboard and kept as a draft until
// Save order; the category page's Featured order follows it.
export function CategoryProducts({
  categoryId,
  products,
  results,
  searched,
}: {
  readonly categoryId: string;
  // In the category's own order.
  readonly products: readonly CategoryProduct[];
  // The search results, or null when nothing was searched.
  readonly results: readonly CategoryProduct[] | null;
  readonly searched: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const loaded = products.map((product) => product.id);
  const loadedKey = loaded.join(",");
  const [order, setOrder] = useState<readonly string[]>(loaded);
  // A refresh with a new list (a save, a reload after stale, an add) replaces the draft.
  const [seen, setSeen] = useState(loadedKey);
  if (seen !== loadedKey) {
    setSeen(loadedKey);
    setOrder(loaded);
  }
  const [discarding, setDiscarding] = useState<Change | null>(null);
  const dirty = order.join(",") !== loadedKey;
  const linked = new Set(loaded);
  const byId = new Map(products.map((product) => [product.id, product]));
  const shown = order.flatMap((id) => {
    const product = byId.get(id);
    return product ? [product] : [];
  });

  function change({ productId, action, name }: Change) {
    setNotice(null);
    setStatus(null);
    setOrder(loaded);
    setBusy(productId);
    startTransition(async () => {
      const result = await setCategoryProducts({
        categoryId,
        add: action === "add" ? [productId] : [],
        remove: action === "remove" ? [productId] : [],
      });
      setBusy(null);
      if (!result.ok) {
        setNotice(errorMessages[result.error.code]);
        return;
      }
      toast.add({
        title: action === "add" ? "Product added" : "Product removed",
        description: name,
        type: "success",
      });
      router.refresh();
    });
  }

  // Remove or Add would drop an unsaved order, so it asks first.
  function request(next: Change) {
    if (dirty) setDiscarding(next);
    else change(next);
  }

  function saveOrder() {
    setNotice(null);
    setStatus(null);
    startTransition(async () => {
      const result = await reorderCategoryProducts({ categoryId, productIds: order });
      if (result.ok) {
        setStatus("Order saved.");
        router.refresh();
        return;
      }
      setNotice(staleOrderMessage);
      setOrder(loaded);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <FormNotice message={notice} />
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products in this category yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            The category page shows its products in this order. Drag a product, or focus its handle
            and use Space and the arrow keys, then save the order.
          </p>
          <SortableList
            label="Products in this category"
            items={shown}
            disabled={pending || !hydrated}
            onReorder={(next) => {
              setStatus(null);
              setOrder(next);
            }}
            renderItem={(product, handle, index) => (
              <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-2 pr-3">
                {handle}
                <span className="w-6 text-right text-sm text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <Link
                  href={productHref(product.id)}
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
                  disabled={pending || !hydrated}
                  onClick={() =>
                    request({ productId: product.id, action: "remove", name: product.name })
                  }
                >
                  <XIcon data-icon="inline-start" aria-hidden="true" />
                  Remove<span className="sr-only"> {product.name}</span>
                </Button>
              </div>
            )}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={!dirty || pending || !hydrated} onClick={saveOrder}>
              {pending && busy === null ? <Spinner data-icon="inline-start" /> : null}
              Save order
            </Button>
            <p role="status" className="text-sm text-muted-foreground">
              {dirty ? "Unsaved order." : status}
            </p>
          </div>
        </div>
      )}

      {results === null ? null : (
        <section aria-labelledby="results-heading" className="flex flex-col gap-3">
          <h3 id="results-heading" className="font-medium">
            Results for &ldquo;{searched}&rdquo;
          </h3>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No product matches that name or SKU.</p>
          ) : (
            <ul aria-label="Search results" className="flex flex-col divide-y rounded-md border">
              {results.map((product) => (
                <li key={product.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-0 flex-1 font-medium">{product.name}</span>
                  <Badge variant={product.status === "active" ? "secondary" : "outline"}>
                    {statusLabels[product.status]}
                  </Badge>
                  {linked.has(product.id) ? (
                    <span className="text-sm text-muted-foreground">In this category</span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending || !hydrated}
                      onClick={() =>
                        request({ productId: product.id, action: "add", name: product.name })
                      }
                    >
                      <PlusIcon data-icon="inline-start" aria-hidden="true" />
                      {busy === product.id ? "Adding…" : "Add"}
                      <span className="sr-only"> {product.name}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog
        open={discarding !== null}
        onOpenChange={(open) => (open ? null : setDiscarding(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard the unsaved order?</DialogTitle>
            <DialogDescription>
              {discarding?.action === "add" ? "Adding" : "Removing"} a product reloads the list in
              its saved order, so the order you arranged is lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep arranging</DialogClose>
            <Button
              type="button"
              onClick={() => {
                const next = discarding;
                setDiscarding(null);
                if (next) change(next);
              }}
            >
              Discard and {discarding?.action === "add" ? "add" : "remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
