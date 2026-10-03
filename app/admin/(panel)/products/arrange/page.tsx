import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getArrangeList } from "@/features/catalog/admin-queries";
import { ArrangeProducts } from "@/features/catalog/components/arrange-products";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Arrange products" });
}

export default async function ArrangeProductsPage() {
  await requireAdmin();
  return <ArrangeProducts products={await getArrangeList()} />;
}
