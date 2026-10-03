import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { NewCategoryPage } from "@/features/categories/components/category-editor";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "New category" });
}

export default async function AdminNewCategoryPage() {
  await requireAdmin();
  return <NewCategoryPage />;
}
