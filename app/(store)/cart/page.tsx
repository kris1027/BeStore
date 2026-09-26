import type { Metadata } from "next";
import { Suspense } from "react";

import { storeContainer } from "@/components/layout/container";
import { CartContents, CartContentsSkeleton } from "@/features/cart/components/cart-contents";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Cart",
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <div className={cn(storeContainer, "flex flex-col gap-8 py-12 md:py-16")}>
      <h1 className="font-heading text-4xl md:text-5xl">Your cart</h1>
      <Suspense fallback={<CartContentsSkeleton />}>
        <CartContents />
      </Suspense>
    </div>
  );
}
