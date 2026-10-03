import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { productImageUrl } from "@/lib/product-image";
import { variantLabel } from "@/lib/variant-label";

import { type ProductSummary, summarizeVariants } from "./product-summary";
import type { ProductStatus } from "./status";

// Not cached: the admin always sees the live tables. Callers run requireAdmin() first.

// The admin list stops here until feature 9 adds paging (spec 0005, AC-1).
export const ADMIN_PRODUCT_LIMIT = 200;

// spec 0009, AC-1: "All" is what the store still sells or may sell (draft and active).
export const productListTabs = ["all", "active", "draft", "archived", "featured"] as const;
export type ProductListTab = (typeof productListTabs)[number];

const listParamsSchema = z.object({
  status: z.enum(productListTabs).catch("all"),
});

export type AdminProductsParams = { readonly tab: ProductListTab };

// An unknown value falls back to its default, never an error (AC-1).
export function parseAdminProductsParams(params: Record<string, unknown>): AdminProductsParams {
  const parsed = listParamsSchema.parse({ status: params.status ?? "all" });
  return { tab: parsed.status };
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

export type AdminProductRow = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: ProductStatus;
  readonly createdAt: Date;
} & ProductSummary;

export async function getAdminProducts(
  params: AdminProductsParams,
): Promise<readonly AdminProductRow[]> {
  const products = await db.product.findMany({
    where: tabWhere(params.tab),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ADMIN_PRODUCT_LIMIT,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      createdAt: true,
      variants: {
        where: { archived: false },
        select: { priceCents: true, stockQuantity: true },
      },
    },
  });
  return products.map(({ variants, ...product }) => ({
    ...product,
    ...summarizeVariants(variants),
  }));
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

  const { optionTypes, variants, images, ...rest } = product;
  const valueAt = new Map(
    optionTypes.flatMap((type, t) =>
      type.values.map((value) => [value.id, { value: value.value, typePosition: t }] as const),
    ),
  );
  return {
    ...rest,
    optionTypes,
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
  readonly kind: "initial" | "adjustment" | "sale";
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
