import type { Metadata } from "next";
import { Suspense } from "react";

import { OrdersList, OrdersListSkeleton } from "@/features/account/components/orders-list";

export const metadata: Metadata = {
  title: "Your orders",
  robots: { index: false, follow: false },
};

export default function AccountOrdersPage({ searchParams }: PageProps<"/account">) {
  return (
    <section aria-labelledby="orders-heading" className="flex flex-col gap-4">
      <h2 id="orders-heading" className="font-heading text-2xl">
        Orders
      </h2>
      <Suspense fallback={<OrdersListSkeleton />}>
        <OrdersList searchParams={searchParams} />
      </Suspense>
    </section>
  );
}
