import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getAdminOrders, parseAdminOrdersParams } from "@/features/orders/admin-queries";
import { AdminOrdersList } from "@/features/orders/components/admin-orders-list";
import { env } from "@/lib/env";

// Reads the session and search params at the top level; allowed to block until converted to
// Suspense (spec 0005, Caching model).
export const instant = false;

export function generateMetadata(): Promise<Metadata> {
  return adminMetadata({ title: "Orders" });
}

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireAdmin();
  const params = parseAdminOrdersParams(await searchParams);
  const page = await getAdminOrders(params);
  return (
    <AdminOrdersList
      page={page}
      params={params}
      dateFormat={{ locale: env.STORE_LOCALE, timeZone: env.STORE_TIMEZONE }}
    />
  );
}
