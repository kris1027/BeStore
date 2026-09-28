import type { Metadata } from "next";
import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import {
  CheckoutComplete,
  CheckoutCompleteSkeleton,
} from "@/features/checkout/components/checkout-complete";
import { cn } from "@/lib/utils";

// The session id in the URL is the key to the order: never indexed, never sent onward in a
// Referer (the header itself is set in next.config.ts).
export const metadata: Metadata = {
  title: "Order confirmation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function CheckoutCompletePage({ searchParams }: PageProps<"/checkout/complete">) {
  return (
    <div className={cn(storeContainer, "flex flex-col gap-8 py-12 md:py-16")}>
      <Suspense fallback={<CheckoutCompleteSkeleton />}>
        <CheckoutComplete searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
