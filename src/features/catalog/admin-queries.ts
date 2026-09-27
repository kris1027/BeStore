import "server-only";

import { db } from "@/lib/db";

import { type ProductSummary, summarizeVariants } from "./product-summary";

// The admin list stops here until feature 9 adds paging (spec 0005, AC-1).
export const ADMIN_PRODUCT_LIMIT = 200;

export type AdminProductRow = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: "draft" | "active" | "archived";
  readonly createdAt: Date;
} & ProductSummary;

// Not cached: the admin always sees the live table. Callers run requireAdmin() first.
export async function getAdminProducts(): Promise<readonly AdminProductRow[]> {
  const products = await db.product.findMany({
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
