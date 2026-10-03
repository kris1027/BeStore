import { z } from "zod";

import { parseMoney, type ParseMoneyError } from "@/lib/money";
import { PRODUCT_IMAGE_PATH } from "@/lib/product-image-rules";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "@/lib/slug";

import {
  combinationCount,
  combinationKey,
  combinations,
  MAX_COMBINATIONS,
  MAX_OPTION_TYPES,
  MAX_OPTION_VALUES,
  SKU_PATTERN,
} from "./variant-grid";

// Pure: the create form (through zodResolver) and the create action parse with the same schema.

export const MAX_STOCK = 999_999;

const priceMessages: Record<ParseMoneyError | "zero", string> = {
  format: "Enter a price like 19.99.",
  decimals: "This currency does not have that many decimals.",
  too_large: "This price is too high.",
  zero: "Enter a price above zero.",
};

const optionTypeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the option, like Size.")
    .max(50, "Keep it under 50 characters."),
  values: z
    .array(z.string().trim().min(1, "Enter a value.").max(50, "Keep it under 50 characters."))
    .min(1, "Add at least one value.")
    .max(MAX_OPTION_VALUES, `Up to ${MAX_OPTION_VALUES} values.`),
});

const dimension = z.number().int().min(1).max(10_000);

// Optional: at most one image, and alt text whenever there is one (AC-5).
const imageSchema = z
  .object({
    path: z.string().regex(PRODUCT_IMAGE_PATH, "Choose the image again."),
    altText: z
      .string()
      .trim()
      .min(1, "Describe the image for people who cannot see it.")
      .max(300, "Keep it under 300 characters."),
    width: dimension,
    height: dimension,
  })
  .nullable();

function variantSchema(currency: string) {
  return z.object({
    // One value per option type, by index; empty for the default variant.
    values: z.array(z.string().trim()),
    price: z.string().transform((text, ctx) => {
      const parsed = parseMoney(text, currency);
      if (!parsed.ok) {
        ctx.addIssue({ code: "custom", message: priceMessages[parsed.error] });
        return z.NEVER;
      }
      if (parsed.cents < 1) {
        ctx.addIssue({ code: "custom", message: priceMessages.zero });
        return z.NEVER;
      }
      return parsed.cents;
    }),
    stock: z
      .string()
      .trim()
      .regex(/^\d+$/, "Enter a whole number.")
      .transform(Number)
      .pipe(z.number().max(MAX_STOCK, `Stock goes up to ${MAX_STOCK}.`)),
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, "Enter a SKU.")
      .regex(SKU_PATTERN, "Use up to 64 letters, digits, dots, dashes or underscores."),
  });
}

// Field rules shared by the create form and the edit sections (spec 0009: edits follow the
// create rules).
export const nameField = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(200, "Keep it under 200 characters.");

export const slugField = z
  .string()
  .trim()
  .min(1, "Enter a URL name.")
  .max(SLUG_MAX_LENGTH, `Keep it under ${SLUG_MAX_LENGTH} characters.`)
  .regex(SLUG_PATTERN, "Use lowercase letters and digits, joined by single hyphens.");

export const DESCRIPTION_MAX_LENGTH = 5000;

export const descriptionField = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX_LENGTH, `Keep it under ${DESCRIPTION_MAX_LENGTH} characters.`);

export const MAX_WEIGHT_GRAMS = 100_000;

// Typed as text; empty means "not set" (spec 0009, AC-5).
export const weightField = z
  .string()
  .trim()
  .transform((text, ctx) => {
    if (text === "") return null;
    const grams = /^\d+$/.test(text) ? Number(text) : Number.NaN;
    if (!Number.isInteger(grams) || grams < 1 || grams > MAX_WEIGHT_GRAMS) {
      ctx.addIssue({
        code: "custom",
        message: `Enter whole grams from 1 to ${MAX_WEIGHT_GRAMS}, or leave it empty.`,
      });
      return z.NEVER;
    }
    return grams;
  });

export function productFormSchema(currency: string) {
  return z
    .object({
      name: nameField,
      slug: slugField,
      description: descriptionField,
      optionTypes: z
        .array(optionTypeSchema)
        .max(MAX_OPTION_TYPES, `Up to ${MAX_OPTION_TYPES} options.`),
      variants: z.array(variantSchema(currency)).min(1).max(MAX_COMBINATIONS),
      image: imageSchema.default(null),
    })
    .superRefine((product, ctx) => {
      const typeNames = new Set<string>();
      product.optionTypes.forEach((type, t) => {
        const name = type.name.toLowerCase();
        if (typeNames.has(name)) {
          ctx.addIssue({
            code: "custom",
            path: ["optionTypes", t, "name"],
            message: "This option is already there.",
          });
        }
        typeNames.add(name);

        const values = new Set<string>();
        type.values.forEach((value, v) => {
          const key = value.toLowerCase();
          if (values.has(key)) {
            ctx.addIssue({
              code: "custom",
              path: ["optionTypes", t, "values", v],
              message: "This value is already there.",
            });
          }
          values.add(key);
        });
      });

      if (combinationCount(product.optionTypes) > MAX_COMBINATIONS) {
        ctx.addIssue({
          code: "custom",
          path: ["optionTypes"],
          message: `These options make more than ${MAX_COMBINATIONS} variants. Remove some values.`,
        });
        return;
      }

      // Exactly one variant per combination: the form generates them, so anything else is a
      // tampered or stale request.
      const expected = new Set(combinations(product.optionTypes).map(combinationKey));
      const seen = new Set<string>();
      const complete =
        product.variants.length === expected.size &&
        product.variants.every((variant) => {
          const key = combinationKey(variant.values);
          const fresh = expected.has(key) && !seen.has(key);
          seen.add(key);
          return fresh;
        });
      if (!complete) {
        ctx.addIssue({
          code: "custom",
          path: ["variants"],
          message: "The variants do not match the options. Reload the page and try again.",
        });
      }

      const skus = new Map<string, number>();
      product.variants.forEach((variant, v) => {
        const first = skus.get(variant.sku);
        if (first !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["variants", v, "sku"],
            message: "Another variant uses this SKU.",
          });
        } else {
          skus.set(variant.sku, v);
        }
      });
    });
}

export type ProductFormInput = z.input<ReturnType<typeof productFormSchema>>;
export type ProductFormValues = z.output<ReturnType<typeof productFormSchema>>;

export const productStatusSchema = z.enum(["draft", "active"]);
export type NewProductStatus = z.infer<typeof productStatusSchema>;

const productId = z.uuid();
// The moment a section was loaded, as the page rendered it (Date.toISOString()).
const loadedAt = z.iso.datetime().transform((text) => new Date(text));

// spec 0009, AC-5: the Details section.
export const detailsSchema = z.object({
  productId,
  loadedUpdatedAt: loadedAt,
  name: nameField,
  slug: slugField,
  description: descriptionField,
  featured: z.boolean(),
  weightGrams: weightField,
});

export type DetailsInput = z.input<typeof detailsSchema>;

// spec 0009, State transitions: the statuses a button can ask for.
export const statusChangeSchema = z.object({
  productId,
  to: z.enum(["draft", "active", "archived"]),
});

// Field errors keyed by their dotted path ("variants.0.price"), which React Hook Form's
// setError accepts as is; the form shows the first message of each.
export function pathErrors(error: z.ZodError): Record<string, readonly string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "root";
    (fields[path] ??= []).push(issue.message);
  }
  return fields;
}
