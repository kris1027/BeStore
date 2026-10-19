"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import type { CategoryOption } from "../admin-queries";

const anyCategory = "";

// The list's category filter, sent with the search form as `category` (spec 0009, AC-1).
// Native (spec 0016), so it works before the app's JavaScript loads.
export function CategoryFilter({
  categories,
  value,
}: {
  readonly categories: readonly CategoryOption[];
  readonly value: string | null;
}) {
  const items = [
    { value: anyCategory, label: "Any category" },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="products-category">Category</Label>
      <NativeSelect
        id="products-category"
        name="category"
        defaultValue={value ?? anyCategory}
        className="w-48"
      >
        {items.map((item) => (
          <NativeSelectOption key={item.value} value={item.value}>
            {item.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
