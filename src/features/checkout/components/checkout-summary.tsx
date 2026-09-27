import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Price } from "@/components/price";
import { ProductImage } from "@/components/product-image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCart } from "@/lib/cart/load-cart";

const cartPath = "/cart";

// spec 0005, AC-13: reread on the server, never trusted from the cart page. No cart, an empty
// one, or any flagged line goes back to the cart, where the reason shows. Feature 7 adds the
// email form and payment here.
export async function CheckoutSummary() {
  const cart = await loadCart();
  if (!cart || !cart.canCheckout) redirect(cartPath);

  return (
    <div className="grid items-start gap-10 lg:grid-cols-3">
      <section aria-labelledby="order-heading" className="flex flex-col gap-4 lg:col-span-2">
        <h2 id="order-heading" className="font-heading text-2xl">
          Your order
        </h2>
        <ul className="flex flex-col">
          {cart.lines.map((line, index) => (
            <li key={line.id} className="flex flex-col">
              {index > 0 ? <Separator /> : null}
              <div className="flex items-center gap-4 py-4">
                <ProductImage
                  src={line.image.src}
                  alt={line.image.alt}
                  sizes="64px"
                  className="w-16 shrink-0"
                />
                <div className="flex flex-1 flex-col gap-0.5">
                  <p className="font-medium">{line.productName}</p>
                  {line.variantLabel ? (
                    <p className="text-sm text-muted-foreground">{line.variantLabel}</p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {line.quantity} × <Price cents={line.priceCents} />
                  </p>
                </div>
                <p className="font-medium">
                  <Price cents={line.totalCents} />
                </p>
              </div>
            </li>
          ))}
        </ul>
        <Link
          href={cartPath}
          className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Edit your cart
        </Link>
      </section>
      <section
        aria-labelledby="checkout-summary-heading"
        className="flex flex-col gap-4 rounded-md border bg-muted/40 p-6"
      >
        <h2 id="checkout-summary-heading" className="font-heading text-2xl">
          Summary
        </h2>
        <div className="flex items-center justify-between">
          <span>Subtotal</span>
          <span className="font-medium">
            <Price cents={cart.subtotalCents} />
          </span>
        </div>
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertTitle>Payment comes next</AlertTitle>
          <AlertDescription>
            Card payment is not open yet. Your cart is saved, so you can come back to pay.
          </AlertDescription>
        </Alert>
      </section>
    </div>
  );
}

export function CheckoutSummarySkeleton() {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-3" aria-hidden="true">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
