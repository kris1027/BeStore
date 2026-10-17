"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// spec 0014, AC-10: part of a plain GET form, so the filter lives in the URL. "Any" sends "",
// which the parser ignores.
export function StatusFilter({
  value,
  items,
}: {
  readonly value: string;
  readonly items: readonly { readonly value: string; readonly label: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="discounts-status">Status</Label>
      <Select items={items} name="status" defaultValue={value}>
        <SelectTrigger id="discounts-status" className="w-44">
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
