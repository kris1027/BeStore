"use client";

import { NativeSelectField, type SelectItem } from "@/components/native-select-field";

// spec 0014, AC-10: part of a plain GET form, so the filter lives in the URL. "Any" sends "",
// which the parser ignores. Native (spec 0016), so it works before the app's JavaScript loads.
export function StatusFilter({
  value,
  items,
}: {
  readonly value: string;
  readonly items: readonly SelectItem[];
}) {
  return (
    <NativeSelectField
      id="discounts-status"
      name="status"
      label="Status"
      items={items}
      defaultValue={value}
      className="w-44"
    />
  );
}
