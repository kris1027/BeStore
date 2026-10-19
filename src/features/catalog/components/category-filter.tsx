"use client";

import { NativeSelectField } from "@/components/native-select-field";

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
    <NativeSelectField
      id="products-category"
      name="category"
      label="Category"
      items={items}
      defaultValue={value ?? anyCategory}
      className="w-48"
    />
  );
}
