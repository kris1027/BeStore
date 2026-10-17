import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { NewDiscountPage } from "@/features/discounts/components/discount-editor";
import { env } from "@/lib/env";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "New code" });
}

export default async function AdminNewDiscountPage() {
  await requireAdmin();
  return <NewDiscountPage currency={env.STORE_CURRENCY} timeZone={env.STORE_TIMEZONE} />;
}
