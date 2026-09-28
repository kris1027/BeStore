import { connection } from "next/server";

import { stripeWebhookRequest } from "@/features/orders/webhook";

export async function POST(request: Request) {
  // Request time only: never prerendered or cached.
  await connection();
  return stripeWebhookRequest(request);
}
