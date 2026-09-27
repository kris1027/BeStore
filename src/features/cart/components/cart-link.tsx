import { ShoppingBagIcon } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { loadCart } from "@/lib/cart/load-cart";
import { cn } from "@/lib/utils";

export const cartPath = "/cart";

// The header's cart link (spec 0005, AC-12). The count reads the cookie, so it streams in
// behind a Suspense boundary and the catalog pages keep a static shell.
export function CartLinkView({ count }: { readonly count: number }) {
  const label = count === 0 ? "Cart" : `Cart, ${count} ${count === 1 ? "item" : "items"}`;
  return (
    <Link
      href={cartPath}
      aria-label={label}
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative size-11")}
    >
      <ShoppingBagIcon className="size-5" aria-hidden="true" />
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute top-1 right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-medium text-primary-foreground tabular-nums"
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

export async function CartLink() {
  const cart = await loadCart();
  return <CartLinkView count={cart?.quantity ?? 0} />;
}
