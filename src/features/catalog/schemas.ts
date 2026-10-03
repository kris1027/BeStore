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

export const optionNameField = z
  .string()
  .trim()
  .min(1, "Name the option, like Size.")
  .max(50, "Keep it under 50 characters.");

export const optionValueField = z
  .string()
  .trim()
  .min(1, "Enter a value.")
  .max(50, "Keep it under 50 characters.");

const optionTypeSchema = z.object({
  name: optionNameField,
  values: z
    .array(optionValueField)
    .min(1, "Add at least one value.")
    .max(MAX_OPTION_VALUES, `Up to ${MAX_OPTION_VALUES} values.`),
});

const dimension = z.number().int().min(1).max(10_000);

// spec 0009, AC-13: up to 8 images, each with alt text.
export const MAX_IMAGES = 8;

export const altTextField = z
  .string()
  .trim()
  .min(1, "Describe the image for people who cannot see it.")
  .max(300, "Keep it under 300 characters.");

const imagePathField = z.string().regex(PRODUCT_IMAGE_PATH, "Choose the image again.");

const tooManyImages = `Up to ${MAX_IMAGES} images.`;

// The create form names an option value by its option type's index and its text: neither has
// an id until the product is saved.
const createImageSchema = z.object({
  path: imagePathField,
  altText: altTextField,
  width: dimension,
  height: dimension,
  optionValue: z
    .object({ typeIndex: z.number().int().min(0), value: z.string().trim() })
    .nullable()
    .default(null),
});

function checkUniquePaths(
  images: readonly { readonly path?: string | undefined }[],
  ctx: z.RefinementCtx,
  at: string,
) {
  const seen = new Set<string>();
  images.forEach((image, index) => {
    if (image.path === undefined) return;
    if (seen.has(image.path)) {
      ctx.addIssue({ code: "custom", path: [at, index], message: "This image is already here." });
    }
    seen.add(image.path);
  });
}

export function priceField(currency: string) {
  return z.string().transform((text, ctx) => {
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
  });
}

// Optional: empty (or left out) means no compare at price. Whether it sits above the selling
// price is checked where both are known.
export function compareAtField(currency: string) {
  return z
    .string()
    .optional()
    .transform((text, ctx) => {
      if (text === undefined || text.trim() === "") return null;
      const parsed = parseMoney(text, currency);
      if (!parsed.ok) {
        ctx.addIssue({ code: "custom", message: priceMessages[parsed.error] });
        return z.NEVER;
      }
      return parsed.cents;
    });
}

export const compareAtMessage = "Enter a price above the selling price.";

export const stockField = z
  .string()
  .trim()
  .regex(/^\d+$/, "Enter a whole number.")
  .transform(Number)
  .pipe(z.number().max(MAX_STOCK, `Stock goes up to ${MAX_STOCK}.`));

export const skuField = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "Enter a SKU.")
  .regex(SKU_PATTERN, "Use up to 64 letters, digits, dots, dashes or underscores.");

// spec 0009, AC-7: a compare at price, when given, sits above the selling price.
function checkCompareAt(
  row: { readonly price: number; readonly compareAt: number | null },
  ctx: z.RefinementCtx,
) {
  if (row.compareAt !== null && row.compareAt <= row.price) {
    ctx.addIssue({ code: "custom", path: ["compareAt"], message: compareAtMessage });
  }
}

function variantSchema(currency: string) {
  return z
    .object({
      // One value per option type, by index; empty for the default variant.
      values: z.array(z.string().trim()),
      price: priceField(currency),
      compareAt: compareAtField(currency),
      stock: stockField,
      sku: skuField,
    })
    .superRefine(checkCompareAt);
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
      featured: z.boolean().default(false),
      weightGrams: weightField.default(null),
      images: z.array(createImageSchema).max(MAX_IMAGES, tooManyImages).default([]),
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

      checkUniquePaths(product.images, ctx, "images");
      product.images.forEach((image, index) => {
        if (image.optionValue === null) return;
        const { typeIndex, value } = image.optionValue;
        const type = product.optionTypes[typeIndex];
        if (!type?.values.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
          ctx.addIssue({
            code: "custom",
            path: ["images", index, "optionValue"],
            message: "Choose a value this product has.",
          });
        }
      });

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

const variantId = z.uuid();
const loadedCents = z.number().int().min(0);

export const NOTE_MAX_LENGTH = 200;

// spec 0009, AC-10: per row, the count the page showed and the count the admin typed.
export const stockSchema = z
  .object({
    productId,
    rows: z
      .array(
        z.object({
          variantId,
          expected: z.number().int().min(0).max(MAX_STOCK),
          next: stockField,
          note: z
            .string()
            .trim()
            .max(NOTE_MAX_LENGTH, `Keep it under ${NOTE_MAX_LENGTH} characters.`)
            .default(""),
        }),
      )
      .min(1)
      .max(MAX_COMBINATIONS),
  })
  .superRefine((input, ctx) => {
    if (new Set(input.rows.map((row) => row.variantId)).size !== input.rows.length) {
      ctx.addIssue({ code: "custom", path: ["rows"], message: "Each variant once." });
    }
  });

export type StockInput = z.input<typeof stockSchema>;

// Duplicate names within one list, compared case insensitively (AC-7: as on create).
function duplicateIndexes(names: readonly string[]): readonly number[] {
  const seen = new Set<string>();
  return names.flatMap((name, index) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return [index];
    seen.add(key);
    return [];
  });
}

// spec 0009, AC-7 and AC-21: every variant row and option name, with what the page loaded so
// the action can refuse a save over someone else's change.
export function variantsSchema(currency: string) {
  return z
    .object({
      productId,
      rows: z
        .array(
          z
            .object({
              variantId,
              loaded: z.object({
                price: loadedCents,
                compareAt: loadedCents.nullable(),
                sku: z.string(),
                archived: z.boolean(),
              }),
              price: priceField(currency),
              compareAt: compareAtField(currency),
              sku: skuField,
              archived: z.boolean(),
            })
            .superRefine(checkCompareAt),
        )
        .min(1)
        .max(MAX_COMBINATIONS),
      optionNames: z
        .array(
          z.object({
            typeId: z.uuid(),
            loadedName: z.string(),
            name: optionNameField,
            values: z
              .array(
                z.object({ valueId: z.uuid(), loadedValue: z.string(), value: optionValueField }),
              )
              .min(1)
              .max(MAX_OPTION_VALUES),
          }),
        )
        .max(MAX_OPTION_TYPES),
    })
    .superRefine((input, ctx) => {
      for (const index of duplicateIndexes(input.optionNames.map((type) => type.name))) {
        ctx.addIssue({
          code: "custom",
          path: ["optionNames", index, "name"],
          message: "This option is already there.",
        });
      }
      input.optionNames.forEach((type, t) => {
        for (const index of duplicateIndexes(type.values.map((entry) => entry.value))) {
          ctx.addIssue({
            code: "custom",
            path: ["optionNames", t, "values", index, "value"],
            message: "This value is already there.",
          });
        }
      });
      for (const index of duplicateIndexes(input.rows.map((row) => row.sku))) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "sku"],
          message: "Another variant uses this SKU.",
        });
      }
    });
}

export type VariantsInput = z.input<ReturnType<typeof variantsSchema>>;
export type VariantsValues = z.output<ReturnType<typeof variantsSchema>>;

// spec 0009, AC-8: a new value for one option type, and one row per new combination.
export function addOptionValueSchema(currency: string) {
  return z
    .object({
      productId,
      optionTypeId: z.uuid(),
      value: optionValueField,
      newVariants: z
        .array(
          z
            .object({
              // The other option types' value ids, in option type order.
              otherValueIds: z.array(z.uuid()).max(MAX_OPTION_TYPES - 1),
              price: priceField(currency),
              compareAt: compareAtField(currency),
              stock: stockField,
              sku: skuField,
            })
            .superRefine(checkCompareAt),
        )
        .min(1)
        .max(MAX_COMBINATIONS),
    })
    .superRefine((input, ctx) => {
      for (const index of duplicateIndexes(input.newVariants.map((row) => row.sku))) {
        ctx.addIssue({
          code: "custom",
          path: ["newVariants", index, "sku"],
          message: "Another variant uses this SKU.",
        });
      }
    });
}

export type AddOptionValueInput = z.input<ReturnType<typeof addOptionValueSchema>>;
export type AddOptionValueValues = z.output<ReturnType<typeof addOptionValueSchema>>;

// spec 0009, AC-13 and AC-21: the images in their new order, each either a stored one (by id)
// or a fresh upload (by path), with what the page loaded so the action can refuse a save over
// someone else's change.
export const imagesSchema = z
  .object({
    productId,
    loaded: z
      .array(
        z.object({
          id: z.uuid(),
          altText: z.string(),
          position: z.number().int().min(0),
          optionValueId: z.uuid().nullable(),
        }),
      )
      .max(MAX_IMAGES * 4),
    images: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            path: imagePathField.optional(),
            altText: altTextField,
            width: dimension.optional(),
            height: dimension.optional(),
            optionValueId: z.uuid().nullable(),
          })
          .superRefine((image, ctx) => {
            const isNew = image.path !== undefined;
            const shaped =
              (image.id === undefined) === isNew &&
              (!isNew || (image.width !== undefined && image.height !== undefined));
            if (!shaped) ctx.addIssue({ code: "custom", message: "Choose the image again." });
          }),
      )
      .max(MAX_IMAGES, tooManyImages),
  })
  .superRefine((input, ctx) => {
    checkUniquePaths(input.images, ctx, "images");
    const ids = input.images.flatMap((image) => (image.id === undefined ? [] : [image.id]));
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["images"], message: "Each image once." });
    }
  });

export type ImagesInput = z.input<typeof imagesSchema>;
export type ImagesValues = z.output<typeof imagesSchema>;
