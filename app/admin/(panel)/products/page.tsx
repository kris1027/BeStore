import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import {
  catalogIsEmpty,
  getAdminProducts,
  getCategoryOptions,
  parseAdminProductsParams,
} from "@/features/catalog/admin-queries";
import { AdminProductsList } from "@/features/catalog/components/admin-products-list";
import { env } from "@/lib/env";

// Reads the session and search params at the top level; allowed to block until converted to
// Suspense (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Products" });
}

export default async function AdminProductsPage({ searchParams }: PageProps<"/admin/products">) {
  await requireAdmin();
  const parsed = parseAdminProductsParams(await searchParams);
  const categories = await getCategoryOptions();
  // spec 0009, AC-1: an unknown category falls back to every category.
  const params = categories.some((category) => category.id === parsed.categoryId)
    ? parsed
    : { ...parsed, categoryId: null };
  const [page, catalogEmpty] = await Promise.all([getAdminProducts(params), catalogIsEmpty()]);
  return (
    <AdminProductsList
      page={page}
      params={params}
      categories={categories}
      catalogEmpty={catalogEmpty}
      dateFormat={{ locale: env.STORE_LOCALE, timeZone: env.STORE_TIMEZONE }}
    />
  );
}
