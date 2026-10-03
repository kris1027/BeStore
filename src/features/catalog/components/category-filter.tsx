"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

import type { CategoryOption } from "../admin-queries";

const anyCategory = "";

// The list's category filter, sent with the search form as `category` (spec 0009, AC-1).
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
      <Select items={items} name="category" defaultValue={value ?? anyCategory}>
        <SelectTrigger id="products-category" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
