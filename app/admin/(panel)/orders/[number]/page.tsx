import type { Metadata } from "next";

import { adminMetadata, requireAdmin } from "@/features/admin-auth/require-admin";
import { getAdminOrder } from "@/features/orders/admin-queries";
import {
  AdminOrderDetail,
  AdminOrderNotFound,
} from "@/features/orders/components/admin-order-detail";
import { env } from "@/lib/env";

// Reads the session at the top level; allowed to block until converted to Suspense
// (spec 0005, Caching model).
export const instant = false;

export async function generateMetadata({
  params,
}: PageProps<"/admin/orders/[number]">): Promise<Metadata> {
  const { number } = await params;
  return adminMetadata({ title: `Order #${number}` });
}

export default async function AdminOrderPage({ params }: PageProps<"/admin/orders/[number]">) {
  await requireAdmin();
  const order = await getAdminOrder((await params).number);
  if (!order) return <AdminOrderNotFound />;
  return (
    <AdminOrderDetail
      order={order}
      dateFormat={{ locale: env.STORE_LOCALE, timeZone: env.STORE_TIMEZONE }}
    />
  );
}
