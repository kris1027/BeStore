import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { SEARCH_MAX_LENGTH, searchProductsForPicker } from "@/features/catalog/admin-queries";
import { getCategoryForEdit } from "@/features/categories/admin-queries";
import { CategoryEditor, CategoryNotFound } from "@/features/categories/components/category-editor";

// Reads the session and search params at the top level; allowed to block until converted to
// Suspense (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Edit category" });
}

// The page joins the two features: the category's own data, and the catalog's product search
// for "Add products" (spec 0009, AC-18). Neither feature imports the other.
export default async function AdminCategoryPage({
  params,
  searchParams,
}: PageProps<"/admin/categories/[id]">) {
  await requireAdmin();
  const category = await getCategoryForEdit((await params).id);
  if (!category) return <CategoryNotFound />;
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, SEARCH_MAX_LENGTH);
  const results = q === "" ? null : await searchProductsForPicker(q);
  return (
    <CategoryEditor
      category={category}
      results={results}
      searched={q}
      searchMaxLength={SEARCH_MAX_LENGTH}
    />
  );
}
