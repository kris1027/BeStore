import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";

import { Price } from "@/components/price";
import { ProductImage } from "@/components/product-image";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import { type CompletedOrder, type Completion, getCompletion } from "../queries";
import { CompleteRefresher } from "./complete-refresher";

const statusLabels: Record<CompletedOrder["status"], string> = {
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const announcements: Record<Completion["state"], string> = {
  paid: "Payment received. Thank you for your order.",
  confirming: "Confirming your payment.",
  processing: "Your payment is processing.",
  not_completed: "Payment not completed.",
};

// spec 0006, AC-11: the page Stripe sends the customer back to. It never changes an order.
export async function CheckoutComplete({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const completion = await getCompletion((await searchParams).session_id);

  return (
    <div className="flex flex-col gap-8">
      {/* Stays mounted across the timed refreshes, so each new state is announced. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcements[completion.state]}
      </p>
      <CompletionView completion={completion} />
    </div>
  );
}

function CompletionView({ completion }: { readonly completion: Completion }) {
  switch (completion.state) {
    case "paid":
      return <PaidOrder order={completion.order} />;
    case "confirming":
      return <CompleteRefresher orderNumber={completion.number} />;
    case "processing":
      return (
        <Message
          title="Your payment is processing"
          body={`Your bank is still confirming the payment for order #${completion.number}. We will confirm your order once it completes; nothing more is needed from you.`}
          action={
            <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Continue shopping
            </Link>
          }
        />
      );
    case "not_completed":
      return (
        <Message
          title="Payment not completed"
          body="No payment went through for this checkout. If you still want your items, you can pay from the checkout page."
          action={
            <Link href="/checkout" className={buttonVariants({ size: "lg" })}>
              Return to checkout
            </Link>
          }
        />
      );
  }
}

function Message({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action: React.ReactNode;
}) {
  return (
    <div className="flex max-w-2xl flex-col items-start gap-4">
      <h1 className="font-heading text-4xl md:text-5xl">{title}</h1>
      <p className="text-lg text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function PaidOrder({ order }: { readonly order: CompletedOrder }) {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CircleCheckIcon aria-hidden="true" className="size-4" />
            {statusLabels[order.status]}
          </p>
          <h1 className="font-heading text-4xl md:text-5xl">Thank you for your order</h1>
          <p className="text-lg text-muted-foreground">
            Your order number is{" "}
            <span className="font-medium text-foreground">#{order.number}</span>, for{" "}
            <span className="font-medium text-foreground">{order.maskedEmail}</span>.
          </p>
        </div>
        <section aria-labelledby="bought-heading" className="flex flex-col gap-2">
          <h2 id="bought-heading" className="font-heading text-2xl">
            What you bought
          </h2>
          <ul className="flex flex-col">
            {order.lines.map((line, index) => (
              <li key={line.id} className="flex flex-col">
                {index > 0 ? <Separator /> : null}
                <div className="flex items-center gap-4 py-4">
                  {/* The name sits beside it, so the picture is decorative. */}
                  <ProductImage src={line.imageSrc} alt="" sizes="64px" className="w-16 shrink-0" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <p className="font-medium">{line.productName}</p>
                    {line.variantLabel ? (
                      <p className="text-sm text-muted-foreground">{line.variantLabel}</p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                      {line.quantity} ×{" "}
                      <Price cents={line.unitPriceCents} currency={order.currency} />
                    </p>
                  </div>
                  <p className="font-medium">
                    <Price cents={line.lineTotalCents} currency={order.currency} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section
        aria-labelledby="paid-summary-heading"
        className="flex flex-col gap-4 rounded-md border bg-muted/40 p-6"
      >
        <h2 id="paid-summary-heading" className="font-heading text-2xl">
          Summary
        </h2>
        <div className="flex items-center justify-between">
          <span>Subtotal</span>
          <Price cents={order.subtotalCents} currency={order.currency} />
        </div>
        {order.shippingCents > 0 ? (
          <div className="flex items-center justify-between">
            <span>Shipping</span>
            <Price cents={order.shippingCents} currency={order.currency} />
          </div>
        ) : null}
        <Separator />
        <div className="flex items-center justify-between text-lg">
          <span className="font-medium">Total paid</span>
          <span className="font-semibold">
            <Price cents={order.totalCents} currency={order.currency} />
          </span>
        </div>
        <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Continue shopping
        </Link>
      </section>
    </div>
  );
}

export function CheckoutCompleteSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
