import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DeliveryAddressBlock } from "@/components/delivery-address";
import { DeliveryRow } from "@/components/delivery-row";
import { Price } from "@/components/price";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { requireCustomer } from "@/lib/customer/session";
import { formatDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { orderStatusLabels } from "@/lib/orders/status-labels";

import { orderNumberParam } from "../order-view";
import { accountPaths } from "../paths";
import { getAccountOrder } from "../queries";

// spec 0012, AC-12 and AC-13: one paid order from its snapshot. A number that does not exist,
// belongs to someone else or to no one, or has a hidden status, renders the same not found.
export async function OrderDetail({ params }: { readonly params: Promise<{ number: string }> }) {
  const customer = await requireCustomer();
  const number = orderNumberParam((await params).number);
  const order = number === null ? null : await getAccountOrder(customer.id, number);
  if (order === null) notFound();

  const format = { locale: env.STORE_LOCALE, timeZone: env.STORE_TIMEZONE };
  const tracking = [
    order.carrier === null ? null : `Carrier: ${order.carrier}`,
    order.trackingNumber === null ? null : `Tracking number: ${order.trackingNumber}`,
  ].filter((part): part is string => part !== null);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={accountPaths.home}
        className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ChevronLeftIcon aria-hidden="true" className="size-4" />
        All orders
      </Link>
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-3xl">Order #{order.number}</h2>
        <p className="text-muted-foreground">
          Paid {formatDate(order.paidAt, format)} · {orderStatusLabels[order.status]}
        </p>
      </div>
      <div className="grid items-start gap-10 lg:grid-cols-3">
        <div className="flex flex-col gap-8 lg:col-span-2">
          <section aria-labelledby="items-heading" className="flex flex-col gap-2">
            <h3 id="items-heading" className="font-heading text-2xl">
              Items
            </h3>
            <ul className="flex flex-col">
              {order.lines.map((line, index) => (
                <li key={line.id} className="flex flex-col">
                  {index > 0 ? <Separator /> : null}
                  <div className="flex items-start justify-between gap-4 py-4">
                    <div className="flex flex-col gap-0.5">
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
          {order.address ? (
            <section aria-labelledby="address-heading" className="flex flex-col gap-2">
              <h3 id="address-heading" className="font-heading text-2xl">
                Delivery address
              </h3>
              <DeliveryAddressBlock address={order.address} />
            </section>
          ) : null}
          {tracking.length > 0 ? (
            <section aria-labelledby="tracking-heading" className="flex flex-col gap-2">
              <h3 id="tracking-heading" className="font-heading text-2xl">
                Tracking
              </h3>
              {tracking.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </section>
          ) : null}
        </div>
        <section
          aria-labelledby="order-summary-heading"
          className="flex flex-col gap-4 rounded-md border bg-muted/40 p-6"
        >
          <h3 id="order-summary-heading" className="font-heading text-2xl">
            Summary
          </h3>
          <div className="flex items-center justify-between">
            <span>Subtotal</span>
            <Price cents={order.subtotalCents} currency={order.currency} />
          </div>
          {order.discountCents > 0 ? (
            <div className="flex items-center justify-between">
              <span>Discount</span>
              <span>
                −<Price cents={order.discountCents} currency={order.currency} />
              </span>
            </div>
          ) : null}
          <DeliveryRow cents={order.shippingCents} currency={order.currency} />
          <Separator />
          <div className="flex items-center justify-between text-lg">
            <span className="font-medium">Total</span>
            <span className="font-semibold">
              <Price cents={order.totalCents} currency={order.currency} />
            </span>
          </div>
          {order.refundedCents > 0 ? (
            <p className="flex items-center justify-between">
              <span>Refunded</span>
              <Price cents={order.refundedCents} currency={order.currency} />
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export function OrderDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
