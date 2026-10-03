import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import {
  catalogIsEmpty,
  getAdminProducts,
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
  const params = parseAdminProductsParams(await searchParams);
  const [products, catalogEmpty] = await Promise.all([getAdminProducts(params), catalogIsEmpty()]);
  return (
    <AdminProductsList
      products={products}
      params={params}
      catalogEmpty={catalogEmpty}
      dateFormat={{ locale: env.STORE_LOCALE, timeZone: env.STORE_TIMEZONE }}
    />
  );
}
