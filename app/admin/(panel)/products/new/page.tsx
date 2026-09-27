import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { ProductForm } from "@/features/catalog/components/product-form";
import { env } from "@/lib/env";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "New product" });
}

export default async function NewProductPage() {
  await requireAdmin();
  // Public values: the browser uploads the image straight to Storage with a signed token.
  return (
    <ProductForm
      storage={{ url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
    />
  );
}
