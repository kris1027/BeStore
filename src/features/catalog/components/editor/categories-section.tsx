"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";

import type { CategoryOption } from "../../admin-queries";
import { updateProductCategories } from "../../actions/update-product-categories";
import { CategoryCheckboxes } from "../category-checkboxes";
import { notFoundMessage, staleMessage } from "./messages";

const errorMessages = {
  unknown_category: "A category was deleted meanwhile. Reload to see the latest.",
  stale: staleMessage,
  not_found: notFoundMessage,
} as const;

// spec 0009, AC-18 and AC-21: the categories this product belongs to.
export function CategoriesSection({
  productId,
  categories,
  categoryIds,
}: {
  readonly productId: string;
  readonly categories: readonly CategoryOption[];
  readonly categoryIds: readonly string[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>(categoryIds);

  function save() {
    setNotice(null);
    startTransition(async () => {
      const result = await updateProductCategories({
        productId,
        loadedCategoryIds: categoryIds,
        categoryIds: selected,
      });
      if (result.ok) {
        toast.add({ title: "Categories saved", type: "success" });
        router.refresh();
        return;
      }
      setNotice(errorMessages[result.error.code]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FormNotice message={notice} />
      <CategoryCheckboxes
        idPrefix="product-category"
        categories={categories}
        value={selected}
        onChange={setSelected}
        disabled={pending}
      />
      {categories.length > 0 ? (
        <Button type="button" className="self-start" disabled={pending || !hydrated} onClick={save}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save categories
        </Button>
      ) : null}
    </div>
  );
}
