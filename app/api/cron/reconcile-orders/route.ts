import { connection } from "next/server";

import { reconcileOrdersRequest } from "@/features/orders/reconcile";

export async function GET(request: Request) {
  // Request time only: never prerendered or cached.
  await connection();
  return reconcileOrdersRequest(request);
}
