import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getDiscountCodeForEdit } from "@/features/discounts/admin-queries";
import { DiscountEditor, DiscountNotFound } from "@/features/discounts/components/discount-editor";
import { env } from "@/lib/env";

// Reads the session and params at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Edit code" });
}

export default async function AdminDiscountPage({ params }: PageProps<"/admin/discounts/[id]">) {
  await requireAdmin();
  const code = await getDiscountCodeForEdit((await params).id);
  if (!code) return <DiscountNotFound />;
  return (
    <DiscountEditor
      code={code}
      money={{ locale: env.STORE_LOCALE, currency: env.STORE_CURRENCY }}
      timeZone={env.STORE_TIMEZONE}
    />
  );
}
