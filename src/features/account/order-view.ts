import { z } from "zod";

import type { OrderStatus } from "@/generated/prisma/enums";

// Pure: which orders an account shows and how their status reads (spec 0012, AC-11). Only orders
// that were paid: a pending, expired or never paid order never shows.

export const visibleStatuses = ["paid", "shipped", "delivered", "cancelled"] as const;

export type VisibleStatus = (typeof visibleStatuses)[number];

export const statusWords: Record<VisibleStatus, string> = {
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function isVisibleStatus(status: OrderStatus): status is VisibleStatus {
  return (visibleStatuses as readonly OrderStatus[]).includes(status);
}

export const ORDERS_PER_PAGE = 20;

const pageSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,5}$/)
  .transform(Number)
  .catch(1);

// `?page=N` from the URL: a whole number from 1, anything else is page 1.
export function pageNumber(value: unknown): number {
  return pageSchema.parse(value);
}

const orderNumberSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform(Number)
  .pipe(z.number().max(2_147_483_647));

// `/account/orders/<number>`: digits only, within Postgres int range, else null (not found).
export function orderNumberParam(value: string): number | null {
  const parsed = orderNumberSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
