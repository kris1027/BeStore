"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";

import type { CategoryOption } from "../admin-queries";

// spec 0009, AC-18: every category as a checkbox, controlled by the form that owns the ids.
export function CategoryCheckboxes({
  idPrefix,
  categories,
  value,
  onChange,
  disabled,
}: {
  readonly idPrefix: string;
  readonly categories: readonly CategoryOption[];
  readonly value: readonly string[];
  readonly onChange: (ids: readonly string[]) => void;
  readonly disabled: boolean;
}) {
  if (categories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No categories yet. Add them under Categories in the menu.
      </p>
    );
  }
  return (
    <FieldSet>
      <FieldLegend variant="label" className="sr-only">
        Categories
      </FieldLegend>
      <div className="grid gap-3 sm:grid-cols-2">
        {categories.map((category) => {
          const id = `${idPrefix}-${category.id}`;
          const checked = value.includes(category.id);
          return (
            <Field key={category.id} orientation="horizontal">
              <Checkbox
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(next) =>
                  onChange(
                    next ? [...value, category.id] : value.filter((entry) => entry !== category.id),
                  )
                }
              />
              <FieldLabel htmlFor={id} className="font-normal">
                {category.name}
              </FieldLabel>
            </Field>
          );
        })}
      </div>
    </FieldSet>
  );
}
