"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormNotice } from "@/components/form-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";

import { reorderCategoryProducts } from "../actions/reorder-category-products";
import { setCategoryProducts } from "../actions/set-category-products";
import type { CategoryProduct } from "../admin-queries";
import { ArrangedProducts } from "./arranged-products";
import { DiscardOrderDialog } from "./discard-order-dialog";
import { statusLabels } from "./product-status";
import { useDraftOrder } from "./use-draft-order";

const errorMessages = {
  unknown_product: "That product was deleted meanwhile. Search again.",
  not_found: "This category no longer exists. Go back to the categories.",
} as const;

const staleOrderMessage =
  "The products in this category changed meanwhile, so the order was not saved. Here is the current list.";

type Change = {
  readonly productId: string;
  readonly action: "add" | "remove";
  readonly name: string;
};

// spec 0009, AC-18: the category's products with Remove buttons, and the "Add products" search
// results with Add buttons. The search itself is a plain GET form on the page.
// spec 0013, AC-23: the list is arranged as a draft until Save order (ArrangedProducts); the
// category page's Featured order follows it.
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
  const draft = useDraftOrder(loaded);
  const [discarding, setDiscarding] = useState<Change | null>(null);
  const linked = new Set(loaded);
  const byId = new Map(products.map((product) => [product.id, product]));
  const shown = draft.order.flatMap((id) => {
    const product = byId.get(id);
    return product ? [product] : [];
  });
  const disabled = pending || !hydrated;

  function change({ productId, action, name }: Change) {
    setNotice(null);
    setStatus(null);
    draft.reset();
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
    if (draft.dirty) setDiscarding(next);
    else change(next);
  }

  function saveOrder() {
    setNotice(null);
    setStatus(null);
    startTransition(async () => {
      const result = await reorderCategoryProducts({ categoryId, productIds: draft.order });
      if (result.ok) {
        setStatus("Order saved.");
        router.refresh();
        return;
      }
      setNotice(staleOrderMessage);
      draft.reset();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <FormNotice message={notice} />
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products in this category yet.</p>
      ) : (
        <ArrangedProducts
          products={shown}
          disabled={disabled}
          saving={pending && busy === null}
          dirty={draft.dirty}
          status={status}
          onReorder={(next) => {
            setStatus(null);
            draft.setOrder(next);
          }}
          onRemove={(product) =>
            request({ productId: product.id, action: "remove", name: product.name })
          }
          onSave={saveOrder}
        />
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
                      disabled={disabled}
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

      <DiscardOrderDialog
        action={discarding?.action ?? null}
        onCancel={() => setDiscarding(null)}
        onConfirm={() => {
          const next = discarding;
          setDiscarding(null);
          if (next) change(next);
        }}
      />
    </div>
  );
}
