import { ReceiptIcon } from "lucide-react";
import Link from "next/link";

import { Price } from "@/components/price";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
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
import { type DateFormat, formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

import type { AdminOrdersPage, AdminOrdersParams } from "../admin-queries";
import { NeedsAttentionBadge, OrderStatusBadge } from "./order-status-badge";

export const adminOrdersPath = "/admin/orders";

export function adminOrderPath(number: number): string {
  return `${adminOrdersPath}/${number}`;
}

function listHref(all: boolean, before: number | null): string {
  const query = new URLSearchParams();
  if (all) query.set("view", "all");
  if (before !== null) query.set("before", String(before));
  const search = query.toString();
  return search ? `${adminOrdersPath}?${search}` : adminOrdersPath;
}

// spec 0006, AC-12.
export function AdminOrdersList({
  page,
  params,
  dateFormat,
}: {
  readonly page: AdminOrdersPage;
  readonly params: AdminOrdersParams;
  readonly dateFormat: DateFormat;
}) {
  const { rows, olderBefore } = page;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {params.all
              ? "Every order, newest first, including checkouts that were never paid."
              : "Paid orders, newest first."}
          </p>
        </div>
        <nav aria-label="Order views" className="flex gap-1 rounded-md border p-1">
          <ViewLink href={listHref(false, null)} current={!params.all}>
            Paid orders
          </ViewLink>
          <ViewLink href={listHref(true, null)} current={params.all}>
            All orders
          </ViewLink>
        </nav>
      </div>
      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>{params.before === null ? "No orders yet" : "No older orders"}</h2>
            </EmptyTitle>
            <EmptyDescription>
              {params.all
                ? "Orders appear here as soon as a customer starts checkout."
                : "Orders appear here once a customer's payment goes through."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Orders" }}>
              <TableCaption className="sr-only">
                {params.all ? "All orders" : "Paid orders"}, newest first
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Ship to</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={adminOrderPath(order.number)}
                        className="underline-offset-4 hover:underline"
                      >
                        #{order.number}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(order.createdAt, dateFormat)}</TableCell>
                    <TableCell className="max-w-64 truncate">{order.email}</TableCell>
                    <TableCell className="max-w-64 truncate">
                      {order.shipTo ?? <span className="text-muted-foreground">Not recorded</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <OrderStatusBadge status={order.status} />
                        {order.needsAttention ? <NeedsAttentionBadge /> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{order.itemCount}</TableCell>
                    <TableCell className="text-right">
                      <Price cents={order.totalCents} currency={order.currency} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {params.before !== null || olderBefore !== null ? (
        <nav aria-label="Pages" className="flex justify-between gap-2">
          {params.before !== null ? (
            <Link
              href={listHref(params.all, null)}
              className={buttonVariants({ variant: "outline" })}
            >
              Newest orders
            </Link>
          ) : (
            <span />
          )}
          {olderBefore !== null ? (
            <Link
              href={listHref(params.all, olderBefore)}
              className={buttonVariants({ variant: "outline" })}
            >
              Older orders
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

function ViewLink({
  href,
  current,
  children,
}: {
  readonly href: string;
  readonly current: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        buttonVariants({ variant: current ? "secondary" : "ghost", size: "sm" }),
        "aria-[current=page]:font-semibold",
      )}
    >
      {children}
    </Link>
  );
}
