import { connection } from "next/server";

import { purgeExpiredOrdersRequest } from "@/features/orders/purge-expired";

// The purge stops itself at 50 seconds (PURGE_TIME_BUDGET_MS), so it always answers in time.
export const maxDuration = 60;

export async function GET(request: Request) {
  // Request time only: never prerendered or cached.
  await connection();
  return purgeExpiredOrdersRequest(request);
}
