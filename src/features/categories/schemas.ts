import { z } from "zod";

import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "@/lib/slug";

// Pure: the category form (zodResolver) and the category actions parse with the same rules
// (spec 0009, AC-17).

export const CATEGORY_DESCRIPTION_MAX_LENGTH = 2000;

export const categoryFieldsSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100, "Keep it under 100 characters."),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a URL name.")
    .max(SLUG_MAX_LENGTH, `Keep it under ${SLUG_MAX_LENGTH} characters.`)
    .regex(SLUG_PATTERN, "Use lowercase letters and digits, joined by single hyphens."),
  // Plain text; empty means none.
  description: z
    .string()
    .trim()
    .max(
      CATEGORY_DESCRIPTION_MAX_LENGTH,
      `Keep it under ${CATEGORY_DESCRIPTION_MAX_LENGTH} characters.`,
    )
    .transform((text) => (text === "" ? null : text)),
  visible: z.boolean(),
});

export type CategoryFieldsInput = z.input<typeof categoryFieldsSchema>;

export const createCategorySchema = categoryFieldsSchema;

export const updateCategorySchema = categoryFieldsSchema.extend({
  categoryId: z.uuid(),
  loadedUpdatedAt: z.iso.datetime().transform((text) => new Date(text)),
});

export const deleteCategorySchema = z.object({ categoryId: z.uuid() });

export const reorderCategoriesSchema = z.object({
  orderedIds: z.array(z.uuid()).max(10_000),
});

export const setCategoryProductsSchema = z.object({
  categoryId: z.uuid(),
  add: z.array(z.uuid()).max(100).default([]),
  remove: z.array(z.uuid()).max(100).default([]),
});

// The first message per field, keyed by field name.
export function categoryFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "root");
    fields[key] ??= issue.message;
  }
  return fields;
}
