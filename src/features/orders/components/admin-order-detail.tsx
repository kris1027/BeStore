import { ArrowLeftIcon, ExternalLinkIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";

import { DeliveryAddressBlock } from "@/components/delivery-address";
import { Price } from "@/components/price";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type DateFormat, formatDate, formatDateTime } from "@/lib/dates";
import { deliveryLabel } from "@/lib/shipping/rule";
import { cn } from "@/lib/utils";

import type { AdminOrderDetail as Detail } from "../admin-queries";
import { emailDisplay } from "../email-display";
import { adminOrdersPath } from "./admin-orders-list";
import { NeedsAttentionBadge, orderStatusLabels, OrderStatusBadge } from "./order-status-badge";

type Event = Detail["events"][number];

function BackLink() {
  return (
    <Link
      href={adminOrdersPath}
      className="flex items-center gap-1 self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      All orders
    </Link>
  );
}

function eventTitle(event: Event): string {
  switch (event.type) {
    case "created":
      return "Order created";
    case "status_changed":
      return event.fromStatus && event.toStatus
        ? `${orderStatusLabels[event.fromStatus]} → ${orderStatusLabels[event.toStatus]}`
        : "Status changed";
    case "stock_shortfall":
      return "Stock shortfall";
    case "note":
      return "Note";
    case "refund_created":
      return "Refund started";
    case "refund_succeeded":
      return "Refund succeeded";
    case "refund_failed":
      return "Refund failed";
  }
}

function actorLabel(event: Event): string {
  if (event.actorType === "admin") return event.adminName ?? "Admin";
  return event.actorType === "customer" ? "Customer" : "System";
}

// spec 0006, AC-13.
export function AdminOrderDetail({
  order,
  dateFormat,
}: {
  readonly order: Detail;
  readonly dateFormat: DateFormat;
}) {
  const reasons = order.events.filter(
    (event) => event.type === "stock_shortfall" || event.type === "note",
  );
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Order #{order.number}</h1>
          <OrderStatusBadge status={order.status} />
          {order.needsAttention ? <NeedsAttentionBadge /> : null}
        </div>
      </div>

      {order.needsAttention ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>This order needs your attention</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {reasons.map((event) => (
                <li key={event.id}>{event.message}</li>
              ))}
            </ul>
            <p>
              If you cannot fulfil it, refund the payment in the Stripe dashboard. Refunds from this
              panel are not available yet.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              <h2>Items</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Items" }}>
              <TableCaption className="sr-only">Items as bought at checkout</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium whitespace-normal">
                      {line.productName}
                      {line.variantLabel ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {line.variantLabel}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{line.sku}</TableCell>
                    <TableCell className="text-right">
                      <Price cents={line.unitPriceCents} currency={order.currency} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                    <TableCell className="text-right">
                      <Price cents={line.lineTotalCents} currency={order.currency} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-2 text-sm">
              <dt>Subtotal</dt>
              <dd className="text-right">
                <Price cents={order.subtotalCents} currency={order.currency} />
              </dd>
              {order.discountCents > 0 ? (
                <>
                  <dt>Discount</dt>
                  <dd className="text-right">
                    −<Price cents={order.discountCents} currency={order.currency} />
                  </dd>
                </>
              ) : null}
              <dt>{deliveryLabel(order.shippingCents)}</dt>
              <dd className="text-right">
                <Price cents={order.shippingCents} currency={order.currency} />
              </dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold">
                <Price cents={order.totalCents} currency={order.currency} />
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Details</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3 text-sm">
              <DetailRow label="Email">
                <EmailValue order={order} dateFormat={dateFormat} />
              </DetailRow>
              <DetailRow label="Delivery address">
                {order.piiPurgedAt !== null ? (
                  <PersonalDataRemoved purgedAt={order.piiPurgedAt} dateFormat={dateFormat} />
                ) : (
                  <DeliveryAddress address={order.address} phone={order.phone} />
                )}
              </DetailRow>
              <DetailRow label="Status">{orderStatusLabels[order.status]}</DetailRow>
              <DetailRow label="Created">{formatDateTime(order.createdAt, dateFormat)}</DetailRow>
              <DetailRow label="Paid">
                {order.paidAt ? formatDateTime(order.paidAt, dateFormat) : "Not paid"}
              </DetailRow>
              <DetailRow label="Stripe payment" className="border-t pt-3">
                <StripeLink id={order.stripe.paymentIntentId} href={order.stripe.paymentUrl} />
              </DetailRow>
              <DetailRow label="Stripe checkout session">
                <StripeLink id={order.stripe.sessionId} href={order.stripe.sessionUrl} />
              </DetailRow>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>History</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-4">
            {order.events.map((event) => (
              <li key={event.id} className="flex flex-col gap-0.5 border-l-2 pl-4">
                <p className="font-medium">{eventTitle(event)}</p>
                {event.message ? <p className="text-sm">{event.message}</p> : null}
                <p className="text-xs text-muted-foreground">
                  <time dateTime={event.createdAt.toISOString()}>
                    {formatDateTime(event.createdAt, dateFormat)}
                  </time>{" "}
                  · {actorLabel(event)}
                </p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}

function DetailRow({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// spec 0007, AC-11: the phone sits inside the block, after the country.
// spec 0008, AC-8: checked before the email and the "No address recorded" branch.
function EmailValue({
  order,
  dateFormat,
}: {
  readonly order: Detail;
  readonly dateFormat: DateFormat;
}) {
  const display = emailDisplay(order);
  switch (display.kind) {
    case "email":
      return <span className="break-all">{display.email}</span>;
    case "purged":
      return <PersonalDataRemoved purgedAt={display.purgedAt} dateFormat={dateFormat} />;
    // The query throws before this; kept so a null email can never render as empty.
    case "missing":
      return <span className="text-destructive">Email missing</span>;
  }
}

function PersonalDataRemoved({
  purgedAt,
  dateFormat,
}: {
  readonly purgedAt: Date;
  readonly dateFormat: DateFormat;
}) {
  return (
    <span className="text-muted-foreground">
      Personal data removed on {formatDate(purgedAt, dateFormat)}
    </span>
  );
}

function DeliveryAddress({
  address,
  phone,
}: {
  readonly address: Detail["address"];
  readonly phone: string | null;
}) {
  if (address === null) return <span className="text-muted-foreground">No address recorded</span>;
  return <DeliveryAddressBlock address={address} phone={phone} />;
}

function StripeLink({ id, href }: { readonly id: string | null; readonly href: string | null }) {
  if (id === null || href === null) return <span className="text-muted-foreground">None</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs break-all underline-offset-4 hover:underline"
    >
      {id}
      <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
      <span className="sr-only">(opens the Stripe dashboard in a new tab)</span>
    </a>
  );
}

// An unknown or malformed number: the panel's own not found state, inside the admin shell.
export function AdminOrderNotFound() {
  return (
    <>
      <BackLink />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>
            <h1>Order not found</h1>
          </EmptyTitle>
          <EmptyDescription>There is no order with this number.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href={adminOrdersPath} className={buttonVariants({ variant: "outline" })}>
            Back to orders
          </Link>
        </EmptyContent>
      </Empty>
    </>
  );
}
