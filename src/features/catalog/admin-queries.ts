import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

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
  readonly activeVariantCount: number;
};

const productIdSchema = z.uuid();

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
      _count: { select: { variants: { where: { archived: false } } } },
    },
  });
  if (!product) return null;
  const { _count, ...rest } = product;
  return { ...rest, activeVariantCount: _count.variants };
}

// The first run state of the list: no product in any status.
export async function catalogIsEmpty(): Promise<boolean> {
  return (await db.product.findFirst({ select: { id: true } })) === null;
}
