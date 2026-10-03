"use client";

import { PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormNotice } from "@/components/form-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";

import { setCategoryProducts } from "../actions/set-category-products";
import type { CategoryProduct } from "../admin-queries";

const statusLabels = { draft: "Draft", active: "Active", archived: "Archived" } as const;

const errorMessages = {
  unknown_product: "That product was deleted meanwhile. Search again.",
  not_found: "This category no longer exists. Go back to the categories.",
} as const;

function productHref(id: string) {
  return `/admin/products/${id}`;
}

// spec 0009, AC-18: the category's products with Remove buttons, and the "Add products" search
// results with Add buttons. The search itself is a plain GET form on the page.
export function CategoryProducts({
  categoryId,
  products,
  results,
  searched,
}: {
  readonly categoryId: string;
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
  const linked = new Set(products.map((product) => product.id));

  function change(productId: string, action: "add" | "remove", name: string) {
    setNotice(null);
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

  return (
    <div className="flex flex-col gap-6">
      <FormNotice message={notice} />
      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products in this category yet.</p>
      ) : (
        <ul
          aria-label="Products in this category"
          className="flex flex-col divide-y rounded-md border"
        >
          {products.map((product) => (
            <li key={product.id} className="flex flex-wrap items-center gap-3 p-3">
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
                onClick={() => change(product.id, "remove", product.name)}
              >
                <XIcon data-icon="inline-start" aria-hidden="true" />
                Remove<span className="sr-only"> {product.name}</span>
              </Button>
            </li>
          ))}
        </ul>
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
                      onClick={() => change(product.id, "add", product.name)}
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
    </div>
  );
}
