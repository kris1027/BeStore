import { ShoppingBagIcon } from "lucide-react";
import Link from "next/link";

import { Price } from "@/components/price";
import { ProductImage } from "@/components/product-image";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCart } from "@/lib/cart/load-cart";

import { CartLineControls } from "./cart-line-controls";

export const checkoutPath = "/checkout";

// Reads the cookie, so it streams in behind the page's Suspense boundary (spec 0005, AC-12).
export async function CartContents() {
  const cart = await loadCart();

  if (!cart || cart.lines.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShoppingBagIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h2>Your cart is empty</h2>
          </EmptyTitle>
          <EmptyDescription>Find something you like, then add it here.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/" className={buttonVariants({ size: "lg", className: "h-11 px-5" })}>
            Continue shopping
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="grid items-start gap-10 lg:grid-cols-3">
      <section aria-labelledby="cart-lines-heading" className="lg:col-span-2">
        <h2 id="cart-lines-heading" className="sr-only">
          Items
        </h2>
        <ul className="flex flex-col">
          {cart.lines.map((line, index) => (
            <li key={line.id} className="flex flex-col">
              {index > 0 ? <Separator /> : null}
              <div className="flex gap-4 py-6">
                <ProductImage
                  src={line.image.src}
                  alt={line.image.alt}
                  sizes="96px"
                  className="w-24 shrink-0"
                />
                <div className="flex flex-1 flex-wrap justify-between gap-x-6 gap-y-2">
                  <div className="flex flex-col gap-1">
                    <Link
                      href={`/products/${line.productSlug}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {line.productName}
                    </Link>
                    {line.variantLabel ? (
                      <p className="text-sm text-muted-foreground">{line.variantLabel}</p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                      <Price cents={line.priceCents} /> each
                    </p>
                  </div>
                  <p className="font-medium">
                    <Price cents={line.totalCents} />
                  </p>
                  <div className="basis-full">
                    <CartLineControls
                      itemId={line.id}
                      quantity={line.quantity}
                      flag={line.flag}
                      productLabel={
                        line.variantLabel
                          ? `${line.productName}, ${line.variantLabel}`
                          : line.productName
                      }
                    />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-labelledby="cart-summary-heading"
        className="flex flex-col gap-4 rounded-md border bg-muted/40 p-6"
      >
        <h2 id="cart-summary-heading" className="font-heading text-2xl">
          Summary
        </h2>
        <div className="flex items-center justify-between">
          <span>Subtotal</span>
          <span className="font-medium">
            <Price cents={cart.subtotalCents} />
          </span>
        </div>
        <p className="text-sm text-muted-foreground">Shipping is added at checkout.</p>
        {cart.canCheckout ? (
          <Link href={checkoutPath} className={buttonVariants({ size: "lg", className: "h-11" })}>
            Checkout
          </Link>
        ) : (
          <>
            {/* Disabled with its reason (AC-11): a flagged line must be fixed first. */}
            <Button size="lg" className="h-11" disabled aria-describedby="checkout-blocked">
              Checkout
            </Button>
            <p id="checkout-blocked" className="text-sm text-destructive">
              Some items need your attention. Fix or remove them to check out.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

export function CartContentsSkeleton() {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-3" aria-hidden="true">
      <div className="flex flex-col gap-6 lg:col-span-2">
        {[0, 1].map((row) => (
          <div key={row} className="flex gap-4">
            <Skeleton className="aspect-product w-24" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
