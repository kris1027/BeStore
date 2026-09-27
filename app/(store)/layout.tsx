import { Suspense } from "react";

import { StoreShell } from "@/components/layout/store-shell";
import { CartLink, CartLinkView } from "@/features/cart/components/cart-link";

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return (
    <StoreShell
      actions={
        <Suspense fallback={<CartLinkView count={0} />}>
          <CartLink />
        </Suspense>
      }
    >
      {children}
    </StoreShell>
  );
}
