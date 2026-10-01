import "server-only";

import { isCronRequest } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const EXPIRED_CART_BATCH = 1000;

// Small batches keep each delete short, so a large backlog never holds long locks. Cart lines
// go with their cart (cascade); an order keeps its row with cart_id set to null. The batch is a
// MATERIALIZED CTE, not `id IN (subquery LIMIT n)`: Postgres can plan the IN as a nested loop
// that rescans the subquery per row, so one statement could delete far more than the LIMIT.
// SKIP LOCKED lets an overlapping run, or a cart write renewing expires_at, pass without
// waiting; a skipped row is picked up by a later batch or the next day's run. The outer
// expires_at check repeats the due condition so only a still-expired row is ever deleted.
// The ::int cast matters: through the pg adapter a JS number may not bind as an integer.
export async function deleteExpiredCarts(): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.$executeRaw`
      WITH due AS MATERIALIZED (
        SELECT id FROM carts
        WHERE expires_at < now()
        LIMIT ${EXPIRED_CART_BATCH}::int
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM carts USING due
      WHERE carts.id = due.id AND carts.expires_at < now()`;
    total += deleted;
    if (deleted === 0) return total;
  }
}

// spec 0005, AC-16: GET /api/cron/expired-carts, run daily by Vercel Cron.
export async function expiredCartsRequest(request: Request): Promise<Response> {
  if (!isCronRequest(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const deleted = await deleteExpiredCarts();
  logger.info({ event: "cron.expired_carts", deleted }, "cron.expired_carts");
  return Response.json({ deleted });
}
