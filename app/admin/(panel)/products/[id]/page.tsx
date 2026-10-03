import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getProductForEdit, getStockHistory } from "@/features/catalog/admin-queries";
import {
  ProductEditor,
  ProductNotFound,
} from "@/features/catalog/components/editor/product-editor";
import { env } from "@/lib/env";

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
  const stockHistory = await getStockHistory(product.id);
  return (
    <ProductEditor
      product={product}
      stockHistory={stockHistory}
      dateFormat={{ locale: env.STORE_LOCALE, timeZone: env.STORE_TIMEZONE }}
      // Public values: the browser uploads images straight to Storage with a signed token.
      storage={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
    />
  );
}
