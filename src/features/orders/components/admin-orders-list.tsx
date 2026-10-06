import { ReceiptIcon } from "lucide-react";
import Link from "next/link";

import { Price } from "@/components/price";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { type DateFormat, formatDate } from "@/lib/dates";

import type { AdminOrdersPage } from "../admin-queries";
import { adminOrdersHref, type AdminOrdersParams, hasFilters } from "../list-params";
import { adminOrderPath, adminOrdersPath } from "../paths";
import { refundState } from "../refund-math";
import { NeedsAttentionBadge, OrderStatusBadge } from "./order-status-badge";
import { OrdersFilters } from "./orders-filters";
import { OrderEmail, PersonalDataField } from "./personal-data";
import { RefundStateBadge } from "./refund-state-badge";

// spec 0006, AC-12 and spec 0010, AC-1 to AC-3.
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
  const filtered = hasFilters(params);
  const all = params.status === "all";
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">
            {all
              ? "Every order, newest first, including checkouts that were never paid."
              : "Newest first. Paid orders unless you choose another status."}
          </p>
        </div>
      </div>
      <OrdersFilters params={params} />
      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>
              <h2>
                {filtered
                  ? "No orders match these filters."
                  : params.before === null
                    ? "No orders yet"
                    : "No older orders"}
              </h2>
            </EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try another search, or clear the filters."
                : "Orders appear here once a customer's payment goes through."}
            </EmptyDescription>
          </EmptyHeader>
          {filtered ? (
            <EmptyContent>
              <Link href={adminOrdersPath} className={buttonVariants({ variant: "outline" })}>
                Clear filters
              </Link>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table containerProps={{ tabIndex: 0, role: "region", "aria-label": "Orders" }}>
              <TableCaption className="sr-only">Orders, newest first</TableCaption>
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
                    <TableCell className="max-w-64 truncate">
                      <OrderEmail order={order} placement="list" />
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      <PersonalDataField purgedAt={order.piiPurgedAt} placement="list">
                        {order.shipTo ?? (
                          <span className="text-muted-foreground">Not recorded</span>
                        )}
                      </PersonalDataField>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <OrderStatusBadge status={order.status} />
                        {order.refundedCents > 0 ? (
                          <RefundStateBadge
                            state={refundState(order.totalCents, order.refundedCents)}
                          />
                        ) : null}
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
            <Link href={adminOrdersHref(params)} className={buttonVariants({ variant: "outline" })}>
              Newest orders
            </Link>
          ) : (
            <span />
          )}
          {olderBefore !== null ? (
            <Link
              href={adminOrdersHref(params, olderBefore)}
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
