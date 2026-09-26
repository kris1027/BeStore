import { cacheLife } from "next/cache";

import { env } from "@/lib/env";

// The store's year, not the server's: on New Year's Eve they can differ.
export function storeYear(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en", { year: "numeric", timeZone }).format(now);
}

// Cache Components refuses `new Date()` in the static shell, so the year is its own cached
// entry. A day's staleness around New Year is fine for a copyright line.
export async function FooterYear() {
  "use cache";
  cacheLife("days");
  return storeYear(new Date(), env.STORE_TIMEZONE);
}
