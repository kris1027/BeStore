import "server-only";

import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

// Every handler under app/api/cron/ checks this first: Vercel Cron sends
// `Authorization: Bearer ${CRON_SECRET}`. Constant time, so the header cannot be guessed byte by
// byte from response times.
export function isCronRequest(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  if (authorization === null) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
