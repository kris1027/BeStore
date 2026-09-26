import "server-only";

import { timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const EXPIRED_CART_BATCH = 1000;

// Constant time, so the header cannot be guessed byte by byte from response times.
function isCronRequest(authorization: string | null): boolean {
  if (authorization === null) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Small batches keep each delete short, so a large backlog never holds long locks. Cart lines
// go with their cart (cascade); an order keeps its row with cart_id set to null.
export async function deleteExpiredCarts(): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.$executeRaw`
      DELETE FROM carts WHERE id IN (
        SELECT id FROM carts WHERE expires_at < now() LIMIT ${EXPIRED_CART_BATCH}
      )`;
    total += deleted;
    if (deleted === 0) return total;
  }
}

// spec 0005, AC-16: GET /api/cron/expired-carts, run daily by Vercel Cron.
export async function expiredCartsRequest(request: Request): Promise<Response> {
  if (!isCronRequest(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const deleted = await deleteExpiredCarts();
  logger.info({ event: "cron.expired_carts", deleted }, "cron.expired_carts");
  return Response.json({ deleted });
}
