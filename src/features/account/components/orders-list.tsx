import { ChevronLeftIcon, ChevronRightIcon, PackageIcon } from "lucide-react";
import Link from "next/link";

import { FormNotice } from "@/components/form-notice";
import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { requireCustomer } from "@/lib/customer/session";
import { formatDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";

import { accountNotice } from "../messages";
import { pageNumber, statusWords } from "../order-view";
import { accountOrderPath, accountPaths } from "../paths";
import { listAccountOrders } from "../queries";

type SearchParams = Record<string, string | string[] | undefined>;

// spec 0012, AC-11: the customer's paid orders, newest first, 20 a page.
export async function OrdersList({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const customer = await requireCustomer();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const { orders, hasNext } = await listAccountOrders(customer.id, page);
  const notice = accountNotice(params.notice);
  const format = { locale: env.STORE_LOCALE, timeZone: env.STORE_TIMEZONE };

  return (
    <div className="flex flex-col gap-6">
      {notice ? <FormNotice message={notice} tone="info" /> : null}
      {orders.length === 0 && page === 1 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No orders yet.</EmptyTitle>
            <EmptyDescription>Orders you place with this email show up here.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link href="/" className={buttonVariants({ size: "lg" })}>
              Go to the shop
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border" aria-label="Orders">
          {orders.map((order) => (
            <li key={order.number}>
              <Link
                href={accountOrderPath(order.number)}
                className="grid grid-cols-2 gap-x-4 gap-y-1 p-4 hover:bg-muted/50 focus-visible:bg-muted/50 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-6"
              >
                <span className="flex flex-col">
                  <span className="font-medium">Order #{order.number}</span>
                  <span className="text-sm text-muted-foreground">
                    Paid {formatDate(order.paidAt, format)}
                  </span>
                </span>
                <span className="justify-self-end text-sm sm:justify-self-start">
                  {statusWords[order.status]}
                </span>
                <span className="text-sm text-muted-foreground">
                  {order.itemCount === 1 ? "1 item" : `${order.itemCount} items`}
                </span>
                <span className="justify-self-end font-medium tabular-nums">
                  {formatMoney(order.totalCents, {
                    currency: order.currency,
                    locale: env.STORE_LOCALE,
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page > 1 || hasNext ? (
        <nav aria-label="Order pages" className="flex items-center justify-between gap-4">
          {page > 1 ? (
            <Link
              href={page === 2 ? accountPaths.home : `${accountPaths.home}?page=${page - 1}`}
              className={buttonVariants({ variant: "outline" })}
            >
              <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
              Previous
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link
              href={`${accountPaths.home}?page=${page + 1}`}
              className={buttonVariants({ variant: "outline" })}
            >
              Next
              <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

export function OrdersListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
