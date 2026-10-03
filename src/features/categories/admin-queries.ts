import "server-only";

import { z } from "zod";

import { db } from "@/lib/db";

// Not cached: the admin always sees the live tables. Callers run requireAdmin() first.

export type AdminCategoryRow = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly visible: boolean;
  // Every status counts (AC-17).
  readonly productCount: number;
};

// spec 0009, AC-17: every category by position.
export async function getAdminCategories(): Promise<readonly AdminCategoryRow[]> {
  const rows = await db.category.findMany({
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      visible: true,
      _count: { select: { products: true } },
    },
  });
  return rows.map(({ _count, ...row }) => ({ ...row, productCount: _count.products }));
}

export type CategoryProduct = {
  readonly id: string;
  readonly name: string;
  readonly status: "draft" | "active" | "archived";
};

export type CategoryForEdit = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly visible: boolean;
  // The conflict token of the category form (AC-21).
  readonly updatedAt: Date;
  // In the category's own order.
  readonly products: readonly CategoryProduct[];
};

const categoryIdSchema = z.uuid();

// spec 0009, AC-17: null for an unknown or malformed id (the page shows its not found state).
export async function getCategoryForEdit(idParam: unknown): Promise<CategoryForEdit | null> {
  const id = categoryIdSchema.safeParse(idParam);
  if (!id.success) return null;
  const category = await db.category.findUnique({
    where: { id: id.data },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      visible: true,
      updatedAt: true,
      products: {
        orderBy: [{ position: "asc" }, { productId: "asc" }],
        select: { product: { select: { id: true, name: true, status: true } } },
      },
    },
  });
  if (!category) return null;
  return { ...category, products: category.products.map((link) => link.product) };
}
