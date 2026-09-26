import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getAdminProducts } from "@/features/catalog/admin-queries";
import { AdminProductsList } from "@/features/catalog/components/admin-products-list";
import { env } from "@/lib/env";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Products" });
}

export default async function AdminProductsPage() {
  await requireAdmin();
  const products = await getAdminProducts();
  return (
    <AdminProductsList
      products={products}
      dateFormat={{ locale: env.STORE_LOCALE, timeZone: env.STORE_TIMEZONE }}
    />
  );
}
