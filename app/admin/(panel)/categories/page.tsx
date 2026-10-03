import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getAdminCategories } from "@/features/categories/admin-queries";
import { CategoriesPage } from "@/features/categories/components/categories-page";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Categories" });
}

export default async function AdminCategoriesPage() {
  await requireAdmin();
  return <CategoriesPage categories={await getAdminCategories()} />;
}
