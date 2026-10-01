import "server-only";

import { isCronRequest } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { pgErrorCode } from "@/lib/db-errors";

import { logPurgeExpiredOrders, logPurgeExpiredOrdersFailed } from "./log";

// spec 0008, AC-10: the privacy policy (feature 16) states this number. Change both together.
export const EXPIRED_ORDER_PII_RETENTION_DAYS = 30;

export const PURGE_BATCH = 1000;

// Under the route's maxDuration of 60 seconds, so a large backlog ends in a clean 200 and the
// next day carries on, instead of a platform timeout with no log.
export const PURGE_TIME_BUDGET_MS = 50_000;

// spec 0008, AC-1 and AC-5: one batch, one statement. SKIP LOCKED lets two overlapping runs take
// different rows without waiting on each other. The outer WHERE repeats the due condition, so the
// update can only ever touch a due row whatever the batch query returns. The cutoff uses
// the database clock, the same one markExpired stamps expired_at with. The ::int casts matter:
// through the pg adapter a JS number may not bind as an integer, and make_interval needs one.
// The batch is a MATERIALIZED CTE, not `id IN (subquery)`: Postgres plans the IN as a nested loop
// that rescans the locking subquery per row, skips the rows this statement already updated, and
// so ignores the LIMIT.
export async function purgeBatch(batch: number): Promise<number> {
  return db.$executeRaw`
    WITH due AS MATERIALIZED (
      SELECT id FROM orders
      WHERE status = 'expired' AND pii_purged_at IS NULL
        AND expired_at < now() - make_interval(days => ${EXPIRED_ORDER_PII_RETENTION_DAYS}::int)
      ORDER BY expired_at
      LIMIT ${batch}::int
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders
    SET email = NULL, customer_name = NULL, phone = NULL,
        ship_full_name = NULL, ship_line1 = NULL, ship_line2 = NULL, ship_city = NULL,
        ship_postal_code = NULL, ship_country_code = NULL,
        cart_id = NULL, customer_id = NULL,
        pii_purged_at = now(), updated_at = now()
    FROM due
    WHERE orders.id = due.id
      AND orders.status = 'expired' AND orders.pii_purged_at IS NULL
      AND orders.expired_at < now() - make_interval(days => ${EXPIRED_ORDER_PII_RETENTION_DAYS}::int)`;
}

export type PurgeResult = { readonly purged: number; readonly error: unknown };

// Never throws: a failed batch comes back as `error` beside the count already committed, which
// stays purged (each batch commits on its own). The next daily run picks up the rest.
export type PurgeOptions = {
  readonly batch?: number;
  readonly runBatch?: (batch: number) => Promise<number>;
  readonly budgetMs?: number;
};

export async function purgeExpiredOrders({
  batch = PURGE_BATCH,
  runBatch = purgeBatch,
  budgetMs = PURGE_TIME_BUDGET_MS,
}: PurgeOptions = {}): Promise<PurgeResult> {
  const start = performance.now();
  let purged = 0;
  for (;;) {
    try {
      const count = await runBatch(batch);
      purged += count;
      if (count === 0) return { purged, error: null };
    } catch (error) {
      return { purged, error };
    }
    if (performance.now() - start >= budgetMs) return { purged, error: null };
  }
}

// spec 0008, AC-4: GET /api/cron/purge-expired-orders, run daily by Vercel Cron. The route
// passes no options; tests pass them to drive the failure path.
export async function purgeExpiredOrdersRequest(
  request: Request,
  options: PurgeOptions = {},
): Promise<Response> {
  if (!isCronRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { purged, error } = await purgeExpiredOrders(options);
  if (error !== null) {
    const errorName = error instanceof Error ? error.name : typeof error;
    logPurgeExpiredOrdersFailed(purged, errorName, pgErrorCode(error));
    return Response.json({ error: "purge_failed", purged }, { status: 500 });
  }
  logPurgeExpiredOrders(purged);
  return Response.json({ purged });
}
