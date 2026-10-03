import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getProductForEdit } from "@/features/catalog/admin-queries";
import {
  ProductEditor,
  ProductNotFound,
} from "@/features/catalog/components/editor/product-editor";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Edit product" });
}

export default async function EditProductPage({ params }: PageProps<"/admin/products/[id]">) {
  await requireAdmin();
  const product = await getProductForEdit((await params).id);
  if (!product) return <ProductNotFound />;
  return <ProductEditor product={product} />;
}
