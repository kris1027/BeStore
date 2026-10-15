import type { Metadata } from "next";
import { Suspense } from "react";

import { OrderDetail, OrderDetailSkeleton } from "@/features/account/components/order-detail";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

export default function AccountOrderPage({ params }: PageProps<"/account/orders/[number]">) {
  return (
    <Suspense fallback={<OrderDetailSkeleton />}>
      <OrderDetail params={params} />
    </Suspense>
  );
}
