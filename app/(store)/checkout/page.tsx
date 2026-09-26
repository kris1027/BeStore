import type { Metadata } from "next";
import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import {
  CheckoutSummary,
  CheckoutSummarySkeleton,
} from "@/features/checkout/components/checkout-summary";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <div className={cn(storeContainer, "flex flex-col gap-8 py-12 md:py-16")}>
      <h1 className="font-heading text-4xl md:text-5xl">Checkout</h1>
      <Suspense fallback={<CheckoutSummarySkeleton />}>
        <CheckoutSummary />
      </Suspense>
    </div>
  );
}
