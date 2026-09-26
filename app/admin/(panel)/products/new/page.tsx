import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { ProductForm } from "@/features/catalog/components/product-form";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "New product" });
}

export default async function NewProductPage() {
  await requireAdmin();
  return <ProductForm />;
}
