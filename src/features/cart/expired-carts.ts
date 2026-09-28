import "server-only";

import { isCronRequest } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const EXPIRED_CART_BATCH = 1000;

// Small batches keep each delete short, so a large backlog never holds long locks. Cart lines
// go with their cart (cascade); an order keeps its row with cart_id set to null. The outer
// expires_at check matters: if a cart is renewed between the subquery and the delete, Postgres
// rechecks only the outer WHERE on the new row version, so without it a live cart would go.
export async function deleteExpiredCarts(): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.$executeRaw`
      DELETE FROM carts WHERE expires_at < now() AND id IN (
        SELECT id FROM carts WHERE expires_at < now() LIMIT ${EXPIRED_CART_BATCH}
      )`;
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
