import { connection } from "next/server";

import { expiredCartsRequest } from "@/features/cart/expired-carts";

export async function GET(request: Request) {
  // Request time only: never prerendered or cached.
  await connection();
  return expiredCartsRequest(request);
}
