"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

// spec 0014, AC-10: part of a plain GET form, so the filter lives in the URL. "Any" sends "",
// which the parser ignores. Native (spec 0016), so it works before the app's JavaScript loads.
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
      <NativeSelect id="discounts-status" name="status" defaultValue={value} className="w-44">
        {items.map((item) => (
          <NativeSelectOption key={item.value} value={item.value}>
            {item.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
