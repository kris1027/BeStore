import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

import { logDashboardQueryFailed, logDashboardSlow } from "./log";
import type { SalesWindow } from "./period";

// spec 0015: every figure is a live SQL sum on each request, with no cache and no stored totals
// (AC-15). Callers run requireAdmin() first.

// Over this, the reads log `dashboard.slow`, so a slow page shows up before anyone complains.
export const SLOW_DASHBOARD_MS = 1_000;

export type SalesTotals = {
  readonly orders: number;
  readonly grossCents: number;
  readonly refundCents: number;
  readonly netCents: number;
  readonly netUnits: number;
};

export type BucketFigures = {
  // As in SalesWindow.buckets: the real first day, and the first day inside the window.
  readonly key: string;
  readonly firstDay: string;
  readonly grossCents: number;
  readonly refundCents: number;
  readonly netCents: number;
};

export type BestSeller = {
  // null once the product was deleted: the name is then the snapshot on its latest line.
  readonly productId: string | null;
  readonly name: string;
  readonly netUnits: number;
  readonly salesCents: number;
};

export type SalesDashboard = {
  readonly current: SalesTotals;
  readonly previous: SalesTotals;
  // One per window bucket, in order, empty ones as 0 (AC-11).
  readonly buckets: readonly BucketFigures[];
  // Top 10 by net units, net units above 0 only (AC-9).
  readonly bestSellers: readonly BestSeller[];
  // Groups left out because their net units are 0 or less.
  readonly hiddenGroups: number;
  // Distinct orders in another currency, paid or refunded in the window (AC-10).
  readonly foreignOrders: number;
};

// Postgres sums and counts come back as bigint. Money sums stay exact only while they are safe
// integers, so anything else is a broken invariant, not a rounding to accept.
export function toSafeNumber(value: bigint | number | null): number {
  if (value === null) return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`dashboard sum is not a safe integer: ${String(value)}`);
  }
  return number;
}

type MoneyRow = {
  readonly is_current: boolean;
  // Set on current window rows only.
  readonly bucket: string | null;
  readonly cents: bigint | null;
  readonly units: bigint | null;
};

type OrderRow = MoneyRow & { readonly orders: bigint };

type BestSellerRow = {
  readonly product_id: string | null;
  readonly name: string;
  readonly net_units: bigint;
  readonly sales: bigint;
  readonly hidden: bigint;
};

type Totals = { readonly cents: number; readonly units: number; readonly orders: number };

function totalsOf(rows: readonly (MoneyRow & { readonly orders?: bigint })[], current: boolean) {
  return rows
    .filter((row) => row.is_current === current)
    .reduce<Totals>(
      (sum, row) => ({
        cents: sum.cents + toSafeNumber(row.cents),
        units: sum.units + toSafeNumber(row.units),
        orders: sum.orders + toSafeNumber(row.orders ?? null),
      }),
      { cents: 0, units: 0, orders: 0 },
    );
}

function salesTotals(orders: Totals, refunds: Totals): SalesTotals {
  return {
    orders: orders.orders,
    grossCents: orders.cents,
    refundCents: refunds.cents,
    netCents: orders.cents - refunds.cents,
    netUnits: orders.units - refunds.units,
  };
}

// A bucket key SQL returned that the window does not list means the two bucket rules disagree,
// and the chart would silently drop money. The queries group by bucket, so each key comes once.
function centsByBucket(
  rows: readonly MoneyRow[],
  keys: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  return new Map(
    rows
      .filter((row) => row.is_current)
      .map((row) => {
        if (row.bucket === null || !keys.has(row.bucket)) {
          throw new Error(`dashboard bucket ${String(row.bucket)} is not in the window`);
        }
        return [row.bucket, toSafeNumber(row.cents)] as const;
      }),
  );
}

// AC-9: a line's best seller group, its product, or its name snapshot once the product is gone.
const lineGroupKey = Prisma.sql`CASE WHEN l.product_id IS NULL THEN 'name:' || l.product_name
  ELSE l.product_id::text END`;

// AC-5: an order (alias o) paid in [start, end). The currency test is left to the caller, since
// AC-10 counts the other currencies.
function paidBetween(start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`o.paid_at >= ${start}::timestamptz AND o.paid_at < ${end}::timestamptz`;
}

// AC-6: a refund (alias r) that succeeded in [start, end).
function refundSucceededBetween(start: Date, end: Date): Prisma.Sql {
  return Prisma.sql`r.status = 'succeeded'
    AND r.succeeded_at >= ${start}::timestamptz
    AND r.succeeded_at < ${end}::timestamptz`;
}

async function readDashboard(window: SalesWindow): Promise<SalesDashboard> {
  const { current, previous, unit } = window;
  const currency = env.STORE_CURRENCY;
  const timeZone = env.STORE_TIMEZONE;

  return db.$transaction(
    async (tx) => {
      // Every figure and every change on the page comes from this one snapshot (AC-15).
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;

      // AC-5, AC-8, AC-11: counted orders of both windows in one scan, bucketed in the store's
      // time zone. The bucket key is text, never a timestamp Prisma would read as UTC.
      const orderRows = await tx.$queryRaw<OrderRow[]>`
        SELECT
          o.paid_at >= ${current.start}::timestamptz AS is_current,
          CASE WHEN o.paid_at >= ${current.start}::timestamptz THEN
            to_char(date_trunc(${unit}::text, o.paid_at AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD')
          END AS bucket,
          count(*)::bigint AS orders,
          sum(o.total_cents)::bigint AS cents,
          coalesce(sum(l.units), 0)::bigint AS units
        FROM orders o
        CROSS JOIN LATERAL (
          SELECT sum(ol.quantity) AS units FROM order_lines ol WHERE ol.order_id = o.id
        ) l
        WHERE ${paidBetween(previous.start, current.end)}
          AND o.currency = ${currency}
        GROUP BY 1, 2`;

      // AC-6, AC-8: a refund counts on the day it succeeded, and only for an order the store
      // recorded as paid.
      const refundRows = await tx.$queryRaw<MoneyRow[]>`
        SELECT
          r.succeeded_at >= ${current.start}::timestamptz AS is_current,
          CASE WHEN r.succeeded_at >= ${current.start}::timestamptz THEN
            to_char(date_trunc(${unit}::text, r.succeeded_at AT TIME ZONE ${timeZone}::text), 'YYYY-MM-DD')
          END AS bucket,
          sum(r.amount_cents)::bigint AS cents,
          coalesce(sum(rl.units), 0)::bigint AS units
        FROM refunds r
        JOIN orders o ON o.id = r.order_id
        CROSS JOIN LATERAL (
          SELECT sum(x.quantity) AS units FROM refund_lines x WHERE x.refund_id = r.id
        ) rl
        WHERE ${refundSucceededBetween(previous.start, current.end)}
          AND o.paid_at IS NOT NULL
          AND o.currency = ${currency}
        GROUP BY 1, 2`;

      // AC-9: lines grouped by product, or by the name snapshot once the product is gone. Sold
      // and refunded groups meet in a FULL JOIN, so a product only refunded in the window is a
      // group too. The rank 1 row always comes back, so `hidden` is known even when no group
      // is listed.
      const bestRows = await tx.$queryRaw<BestSellerRow[]>`
        WITH sold AS (
          SELECT
            ${lineGroupKey} AS key,
            l.product_id,
            sum(l.quantity)::bigint AS units,
            sum(l.line_total_cents)::bigint AS sales,
            max(l.created_at) AS last_at,
            (array_agg(l.product_name ORDER BY l.created_at DESC, l.id DESC))[1] AS last_name
          FROM orders o
          JOIN order_lines l ON l.order_id = o.id
          WHERE ${paidBetween(current.start, current.end)}
            AND o.currency = ${currency}
          GROUP BY 1, 2
        ),
        refunded AS (
          SELECT
            ${lineGroupKey} AS key,
            l.product_id,
            sum(rl.quantity)::bigint AS units,
            max(l.created_at) AS last_at,
            (array_agg(l.product_name ORDER BY l.created_at DESC, l.id DESC))[1] AS last_name
          FROM refunds r
          JOIN orders o ON o.id = r.order_id
          JOIN refund_lines rl ON rl.refund_id = r.id
          JOIN order_lines l ON l.id = rl.order_line_id
          WHERE ${refundSucceededBetween(current.start, current.end)}
            AND o.paid_at IS NOT NULL
            AND o.currency = ${currency}
          GROUP BY 1, 2
        ),
        groups AS (
          SELECT
            coalesce(sold.product_id, refunded.product_id) AS product_id,
            coalesce(sold.units, 0) - coalesce(refunded.units, 0) AS net_units,
            coalesce(sold.sales, 0) AS sales,
            CASE WHEN refunded.last_at IS NULL OR sold.last_at >= refunded.last_at
              THEN sold.last_name ELSE refunded.last_name END AS line_name
          FROM sold
          FULL OUTER JOIN refunded ON refunded.key = sold.key
        ),
        named AS (
          SELECT p.id AS product_id, coalesce(p.name, g.line_name) AS name, g.net_units, g.sales
          FROM groups g
          LEFT JOIN products p ON p.id = g.product_id
        ),
        ranked AS (
          SELECT
            *,
            count(*) FILTER (WHERE net_units <= 0) OVER () AS hidden,
            row_number() OVER (ORDER BY net_units DESC, sales DESC, name ASC) AS rank
          FROM named
        )
        SELECT product_id, name, net_units, sales, hidden
        FROM ranked
        WHERE rank = 1 OR (net_units > 0 AND rank <= 10)
        ORDER BY rank`;

      // AC-10: orders in another currency paid in the window, or refunded in it.
      const [foreign] = await tx.$queryRaw<{ readonly count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM (
          SELECT o.id FROM orders o
          WHERE ${paidBetween(current.start, current.end)}
            AND o.currency <> ${currency}
          UNION
          SELECT r.order_id FROM refunds r
          JOIN orders o ON o.id = r.order_id
          WHERE ${refundSucceededBetween(current.start, current.end)}
            AND o.currency <> ${currency}
        ) foreign_orders`;

      const keys = new Set(window.buckets.map((bucket) => bucket.key));
      const grossByBucket = centsByBucket(orderRows, keys);
      const refundsByBucket = centsByBucket(refundRows, keys);

      return {
        current: salesTotals(totalsOf(orderRows, true), totalsOf(refundRows, true)),
        previous: salesTotals(totalsOf(orderRows, false), totalsOf(refundRows, false)),
        buckets: window.buckets.map(({ key, firstDay }) => {
          const grossCents = grossByBucket.get(key) ?? 0;
          const refundCents = refundsByBucket.get(key) ?? 0;
          return { key, firstDay, grossCents, refundCents, netCents: grossCents - refundCents };
        }),
        bestSellers: bestRows
          .map((row) => ({
            productId: row.product_id,
            name: row.name,
            netUnits: toSafeNumber(row.net_units),
            salesCents: toSafeNumber(row.sales),
          }))
          .filter((row) => row.netUnits > 0),
        hiddenGroups: toSafeNumber(bestRows[0]?.hidden ?? null),
        foreignOrders: toSafeNumber(foreign?.count ?? null),
      };
    },
    // A transaction holds one connection, so the reads run one after another.
    { isolationLevel: "RepeatableRead", timeout: 15_000 },
  );
}

export async function getSalesDashboard(window: SalesWindow): Promise<SalesDashboard> {
  const fields = { period: window.preset ?? "custom", days: window.dayCount };
  const started = performance.now();
  try {
    const dashboard = await readDashboard(window);
    const durationMs = Math.round(performance.now() - started);
    if (durationMs > SLOW_DASHBOARD_MS) logDashboardSlow(fields, durationMs);
    return dashboard;
  } catch (error) {
    // AC-14: app/error.tsx shows the error page.
    logDashboardQueryFailed(fields, error);
    throw error;
  }
}
