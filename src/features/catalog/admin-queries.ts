import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { SEARCH_MAX_LENGTH, firstValue, searchQuerySchema } from "@/lib/admin-search";
import { db } from "@/lib/db";
import { escapeLike } from "@/lib/like";
import { PLACEHOLDER_IMAGE, productImageUrl } from "@/lib/product-image";
import { variantLabel } from "@/lib/variant-label";

import { type ProductSummary, summarizeVariants } from "./product-summary";
import type { ProductStatus } from "./status";

// Not cached: the admin always sees the live tables. Callers run requireAdmin() first.

export const ADMIN_PRODUCTS_PAGE_SIZE = 50;
export { SEARCH_MAX_LENGTH };

// spec 0009, AC-1: "All" is what the store still sells or may sell (draft and active);
// Featured is the featured ones among those.
export const productListTabs = ["all", "active", "draft", "archived", "featured"] as const;
export type ProductListTab = (typeof productListTabs)[number];

const listParamsSchema = z.object({
  status: z.enum(["active", "draft", "archived"]).optional().catch(undefined),
  featured: z.literal("1").optional().catch(undefined),
  q: searchQuerySchema,
  category: z.uuid().optional().catch(undefined),
  before: z.uuid().optional().catch(undefined),
});

export type AdminProductsParams = {
  readonly tab: ProductListTab;
  // Trimmed, up to 100 characters; "" for no search.
  readonly q: string;
  readonly categoryId: string | null;
  // The id the page starts below (keyset paging, newest first), or null on the first page.
  readonly before: string | null;
};

// Every filter lives in the URL; an unknown or malformed value falls back to its default,
// never an error (AC-1). An unknown category id is dropped by the page once it has the list.
export function parseAdminProductsParams(params: Record<string, unknown>): AdminProductsParams {
  const parsed = listParamsSchema.parse({
    status: firstValue(params.status),
    featured: firstValue(params.featured),
    q: firstValue(params.q),
    category: firstValue(params.category),
    before: firstValue(params.before),
  });
  return {
    tab: parsed.featured ? "featured" : (parsed.status ?? "all"),
    q: parsed.q,
    categoryId: parsed.category ?? null,
    before: parsed.before ?? null,
  };
}

function tabWhere(tab: ProductListTab): Prisma.ProductWhereInput {
  switch (tab) {
    case "all":
      return { status: { in: ["draft", "active"] } };
    case "featured":
      return { status: { in: ["draft", "active"] }, featured: true };
    default:
      return { status: tab };
  }
}

// Name or any variant SKU, case insensitive, contains (AC-1).
function searchWhere(q: string): Prisma.ProductWhereInput {
  if (q === "") return {};
  const contains = escapeLike(q);
  return {
    OR: [
      { name: { contains, mode: "insensitive" } },
      { variants: { some: { sku: { contains, mode: "insensitive" } } } },
    ],
  };
}

export type AdminProductRow = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: ProductStatus;
  readonly featured: boolean;
  readonly createdAt: Date;
} & ProductSummary;

export type AdminProductsPage = {
  readonly rows: readonly AdminProductRow[];
  // The `before` value of the next page, or null on the last page.
  readonly nextBefore: string | null;
};

// spec 0009, AC-1: 50 at a time, newest first. Keyset paging on the UUID v7 id (time ordered),
// so a page stays stable while products are added.
export async function getAdminProducts(params: AdminProductsParams): Promise<AdminProductsPage> {
  const products = await db.product.findMany({
    where: {
      AND: [
        tabWhere(params.tab),
        searchWhere(params.q),
        params.categoryId === null
          ? {}
          : { categories: { some: { categoryId: params.categoryId } } },
        params.before === null ? {} : { id: { lt: params.before } },
      ],
    },
    orderBy: { id: "desc" },
    take: ADMIN_PRODUCTS_PAGE_SIZE + 1,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      featured: true,
      createdAt: true,
      variants: {
        where: { archived: false },
        select: { priceCents: true, stockQuantity: true },
      },
    },
  });
  const page = products.slice(0, ADMIN_PRODUCTS_PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page.map(({ variants, ...product }) => ({ ...product, ...summarizeVariants(variants) })),
    nextBefore: products.length > ADMIN_PRODUCTS_PAGE_SIZE && last ? last.id : null,
  };
}

export type CategoryOption = { readonly id: string; readonly name: string };

// The category select of the list and the Categories section's checkboxes, by position.
export async function getCategoryOptions(): Promise<readonly CategoryOption[]> {
  return db.category.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
}

export const PICKER_LIMIT = 20;

export type PickerProduct = {
  readonly id: string;
  readonly name: string;
  readonly status: ProductStatus;
};

// spec 0009, AC-18: the "Add products" search of a category page: name or SKU, any status.
export async function searchProductsForPicker(q: string): Promise<readonly PickerProduct[]> {
  const text = q.trim().slice(0, SEARCH_MAX_LENGTH);
  if (text === "") return [];
  return db.product.findMany({
    where: searchWhere(text),
    orderBy: { id: "desc" },
    take: PICKER_LIMIT,
    select: { id: true, name: true, status: true },
  });
}

export type EditOptionType = {
  readonly id: string;
  readonly name: string;
  readonly values: readonly { readonly id: string; readonly value: string }[];
};

export type EditVariant = {
  readonly id: string;
  readonly sku: string;
  readonly priceCents: number;
  readonly compareAtPriceCents: number | null;
  readonly stockQuantity: number;
  readonly archived: boolean;
  // One value id per option type, in option type order; empty for a default variant.
  readonly optionValueIds: readonly string[];
  // "M / Navy", or "Default" for a product without options.
  readonly label: string;
};

export type EditImage = {
  readonly id: string;
  readonly src: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly altText: string;
  readonly position: number;
  readonly optionValueId: string | null;
};

export type ProductForEdit = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly status: ProductStatus;
  readonly featured: boolean;
  readonly weightGrams: number | null;
  // The Details conflict token (AC-21): only Details and status saves change it.
  readonly updatedAt: Date;
  readonly optionTypes: readonly EditOptionType[];
  // Every variant, archived ones included, by position.
  readonly variants: readonly EditVariant[];
  readonly images: readonly EditImage[];
  readonly categoryIds: readonly string[];
  // Not active and on no order line, by product or variant (AC-4).
  readonly deletable: boolean;
};

const productIdSchema = z.uuid();

export const DEFAULT_VARIANT_LABEL = "Default";

// spec 0009, AC-17: null for an unknown or malformed id (the page shows its not found state).
export async function getProductForEdit(idParam: unknown): Promise<ProductForEdit | null> {
  const id = productIdSchema.safeParse(idParam);
  if (!id.success) return null;

  const product = await db.product.findUnique({
    where: { id: id.data },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      featured: true,
      weightGrams: true,
      updatedAt: true,
      optionTypes: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          values: { orderBy: { position: "asc" }, select: { id: true, value: true } },
        },
      },
      categories: { select: { categoryId: true } },
      _count: { select: { orderLines: true } },
      images: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          storagePath: true,
          width: true,
          height: true,
          altText: true,
          position: true,
          optionValueId: true,
        },
      },
      variants: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          sku: true,
          priceCents: true,
          compareAtPriceCents: true,
          stockQuantity: true,
          archived: true,
          optionValues: { select: { optionValueId: true } },
        },
      },
    },
  });
  if (!product) return null;

  const { optionTypes, variants, images, categories, _count, ...rest } = product;
  const variantOrders =
    rest.status === "active" || _count.orderLines > 0
      ? 0
      : await db.orderLine.count({ where: { variantId: { in: variants.map((v) => v.id) } } });
  const valueAt = new Map(
    optionTypes.flatMap((type, t) =>
      type.values.map((value) => [value.id, { value: value.value, typePosition: t }] as const),
    ),
  );
  return {
    ...rest,
    optionTypes,
    categoryIds: categories.map((link) => link.categoryId),
    deletable: rest.status !== "active" && _count.orderLines === 0 && variantOrders === 0,
    images: images.map(({ storagePath, ...image }) => ({
      ...image,
      src: productImageUrl(storagePath),
    })),
    variants: variants.map(({ optionValues, ...variant }) => {
      const values = optionValues.flatMap((link) => {
        const value = valueAt.get(link.optionValueId);
        return value ? [{ id: link.optionValueId, ...value }] : [];
      });
      const ordered = values.toSorted((a, b) => a.typePosition - b.typePosition);
      return {
        ...variant,
        optionValueIds: ordered.map((value) => value.id),
        label: variantLabel(ordered) ?? DEFAULT_VARIANT_LABEL,
      };
    }),
  };
}

export const STOCK_HISTORY_LIMIT = 50;

export type StockHistoryRow = {
  readonly id: string;
  readonly createdAt: Date;
  readonly variantLabel: string;
  readonly kind: "initial" | "adjustment" | "sale" | "return";
  readonly delta: number;
  readonly stockAfter: number;
  readonly note: string | null;
  // Who: an admin's name (disabled admins too), an order, or the system (the backfill).
  readonly actor:
    | { readonly type: "admin"; readonly name: string }
    | { readonly type: "order"; readonly number: number }
    | { readonly type: "system" };
};

// spec 0009, AC-11: the latest movements of the product's variants, newest first.
export async function getStockHistory(productId: string): Promise<readonly StockHistoryRow[]> {
  const rows = await db.stockMovement.findMany({
    where: { variant: { productId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: STOCK_HISTORY_LIMIT,
    select: {
      id: true,
      createdAt: true,
      kind: true,
      delta: true,
      stockAfter: true,
      note: true,
      admin: { select: { name: true } },
      order: { select: { number: true } },
      variant: {
        select: {
          optionValues: {
            select: {
              optionValue: { select: { value: true, optionType: { select: { position: true } } } },
            },
          },
        },
      },
    },
  });
  return rows.map(({ admin, order, variant, ...row }) => ({
    ...row,
    variantLabel:
      variantLabel(
        variant.optionValues.map(({ optionValue }) => ({
          value: optionValue.value,
          typePosition: optionValue.optionType.position,
        })),
      ) ?? DEFAULT_VARIANT_LABEL,
    actor: admin
      ? { type: "admin", name: admin.name }
      : order
        ? { type: "order", number: order.number }
        : { type: "system" },
  }));
}

// The first run state of the list: no product in any status.
export async function catalogIsEmpty(): Promise<boolean> {
  return (await db.product.findFirst({ select: { id: true } })) === null;
}

export type ArrangeItem = {
  readonly id: string;
  readonly name: string;
  // The card image, or the placeholder.
  readonly src: string;
};

// spec 0009, AC-20: every active product in home grid order.
export async function getArrangeList(): Promise<readonly ArrangeItem[]> {
  const products = await db.product.findMany({
    where: { status: "active" },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      name: true,
      images: { orderBy: { position: "asc" }, take: 1, select: { storagePath: true } },
    },
  });
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    src: product.images[0] ? productImageUrl(product.images[0].storagePath) : PLACEHOLDER_IMAGE,
  }));
}
