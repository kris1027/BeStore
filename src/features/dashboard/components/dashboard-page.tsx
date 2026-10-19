import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { FormNotice } from "@/components/form-notice";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, type MoneyFormat } from "@/lib/money";

import { averageChange, averageOrderValue, figureChange } from "../change";
import { paidOrdersPath } from "../paths";
import { bucketLabel, formatStoreDay, type SalesWindow } from "../period";
import { getSalesDashboard } from "../queries";
import { BestSellersTable } from "./best-sellers-table";
import { PeriodPicker } from "./period-picker";
import { RevenueChart } from "./revenue-chart";
import { StatCard, StatCardSkeleton } from "./stat-card";

type DashboardPageProps = {
  readonly adminName: string;
  readonly window: SalesWindow;
  readonly today: string;
  readonly money: MoneyFormat;
};

function rangeText(first: string, last: string, locale: string): string {
  return first === last
    ? formatStoreDay(first, locale)
    : `${formatStoreDay(first, locale)} to ${formatStoreDay(last, locale)}`;
}

// spec 0015, AC-1: the admin landing page.
export function DashboardPage({ adminName, window, today, money }: DashboardPageProps) {
  const { current, previous } = window;
  const custom = window.preset === null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Signed in as {adminName}</p>
      </div>
      <div className="flex flex-col gap-3">
        <PeriodPicker
          key={`${window.preset ?? "custom"}:${current.firstDay}:${current.lastDay}`}
          preset={window.preset}
          from={custom ? current.firstDay : ""}
          to={custom ? current.lastDay : ""}
          today={today}
        />
        <p className="text-sm text-muted-foreground">
          Showing {rangeText(current.firstDay, current.lastDay, money.locale)}, compared with{" "}
          {rangeText(previous.firstDay, previous.lastDay, money.locale)}.
        </p>
        {window.rejectedRange ? (
          <FormNotice
            tone="info"
            message="That date range can't be used. Showing the last 30 days."
          />
        ) : null}
      </div>
      {/* Keyed by the window, so picking another period shows the skeletons again. */}
      <Suspense
        key={`${current.firstDay}:${current.lastDay}`}
        fallback={<DashboardFiguresSkeleton />}
      >
        <DashboardFigures window={window} money={money} />
      </Suspense>
    </>
  );
}

async function DashboardFigures({
  window,
  money,
}: {
  readonly window: SalesWindow;
  readonly money: MoneyFormat;
}) {
  const dashboard = await getSalesDashboard(window);
  const { current, previous } = dashboard;
  const days = window.dayCount;
  const count = new Intl.NumberFormat(money.locale);
  const average = averageOrderValue(current.grossCents, current.orders);
  const foreign = dashboard.foreignOrders;

  return (
    <>
      {foreign > 0 ? (
        <FormNotice
          tone="info"
          message={
            foreign === 1
              ? "1 order in another currency is left out of these figures."
              : `${count.format(foreign)} orders in another currency are left out of these figures.`
          }
        />
      ) : null}
      <section aria-labelledby="figures-heading">
        <h2 id="figures-heading" className="sr-only">
          Key figures
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Net revenue"
            value={formatMoney(current.netCents, money)}
            details={[
              `Gross ${formatMoney(current.grossCents, money)}`,
              `Refunds ${formatMoney(current.refundCents, money)}`,
            ]}
            change={figureChange(current.netCents, previous.netCents, days)}
          />
          <StatCard
            title="Orders"
            value={count.format(current.orders)}
            change={figureChange(current.orders, previous.orders, days)}
            footer={
              <Link
                href={paidOrdersPath(window.current)}
                className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
              >
                View these orders
                <ArrowRightIcon aria-hidden="true" className="size-4" />
              </Link>
            }
          />
          <StatCard
            title="Average order value"
            value={average === null ? "No orders" : formatMoney(average, money)}
            change={averageChange(current, previous, days)}
          />
          <StatCard
            title="Net units sold"
            value={count.format(current.netUnits)}
            change={figureChange(current.netUnits, previous.netUnits, days)}
          />
        </div>
      </section>
      <div className="grid items-start gap-4 xl:grid-cols-5">
        <Card className="min-w-0 xl:col-span-3">
          <CardContent>
            <RevenueChart
              unit={window.unit}
              rows={dashboard.buckets.map((bucket) => ({
                key: bucket.key,
                label: bucketLabel(bucket, window.unit, money.locale),
                grossCents: bucket.grossCents,
                refundCents: bucket.refundCents,
                netCents: bucket.netCents,
              }))}
            />
          </CardContent>
        </Card>
        <Card className="min-w-0 xl:col-span-2">
          <CardContent>
            <BestSellersTable
              rows={dashboard.bestSellers}
              hiddenGroups={dashboard.hiddenGroups}
              money={money}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// AC-14: the cards, the chart and the table hold their place while the figures load.
function DashboardFiguresSkeleton() {
  return (
    <>
      <p role="status" className="sr-only">
        Loading the figures
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-5" aria-hidden="true">
        <Card className="xl:col-span-3">
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="gap-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
