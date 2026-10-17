import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getDiscountCodes } from "@/features/discounts/admin-queries";
import { DiscountsList } from "@/features/discounts/components/discounts-list";
import { parseDiscountListParams } from "@/features/discounts/list-params";
import { env } from "@/lib/env";

// Reads the session and search params at the top level; allowed to block until converted to
// Suspense (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Discounts" });
}

export default async function AdminDiscountsPage({ searchParams }: PageProps<"/admin/discounts">) {
  await requireAdmin();
  const params = parseDiscountListParams(await searchParams);
  return (
    <DiscountsList
      list={await getDiscountCodes(params)}
      params={params}
      dateFormat={{ locale: env.STORE_LOCALE, timeZone: env.STORE_TIMEZONE }}
      money={{ locale: env.STORE_LOCALE, currency: env.STORE_CURRENCY }}
    />
  );
}
