import { z } from "zod";

import type { OrderStatus } from "@/generated/prisma/enums";
import { firstValue, searchQuerySchema } from "@/lib/admin-search";
import { parseCalendarDay } from "@/lib/dates";
import { maxOrderNumber } from "@/lib/orders/order-number";

import { adminOrdersPath } from "./paths";
import type { RefundState } from "./refund-math";

// Pure: the /admin/orders filters as they live in the URL (spec 0010, AC-1 to AC-3). Every
// invalid value is ignored, never an error, so a shared or old link always opens.

export const orderStatusFilters = [
  "paid",
  "shipped",
  "delivered",
  "cancelled",
  "pending_payment",
  "expired",
  "all",
] as const;

// "settled" is the default view: the orders that took money.
export type StatusFilter = OrderStatus | "all" | "settled";

// Which date `from` and `to` filter: when the order was placed, or when it was paid (spec 0015,
// AC-13, the dashboard's "View these orders").
export const orderDateFilters = ["created", "paid"] as const;
export type DateFilter = (typeof orderDateFilters)[number];

export type AdminOrdersParams = {
  readonly q: string;
  readonly status: StatusFilter;
  readonly attention: boolean;
  readonly refund: RefundState | null;
  // Both YYYY-MM-DD in the store's time zone, inclusive; both null when from is after to.
  readonly from: string | null;
  readonly to: string | null;
  // "paid" also leaves out every order without a paid_at, with or without from and to.
  readonly dates: DateFilter;
  readonly before: number | null;
  // spec 0014, AC-14: only orders that used this promo code (its id). The page drops an id that
  // is not a code.
  readonly discount: string | null;
};

const schema = z.object({
  status: z.enum(orderStatusFilters).optional().catch(undefined),
  view: z.enum(["all"]).optional().catch(undefined),
  attention: z.enum(["1"]).optional().catch(undefined),
  refund: z.enum(["none", "partial", "full"]).optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  dates: z.enum(orderDateFilters).optional().catch(undefined),
  before: z.coerce.number().int().min(1).max(maxOrderNumber).optional().catch(undefined),
  discount: z.uuid().optional().catch(undefined),
});

function day(text: string | undefined): string | null {
  return text !== undefined && parseCalendarDay(text) !== null ? text : null;
}

export function parseAdminOrdersParams(
  params: Readonly<Record<string, unknown>>,
): AdminOrdersParams {
  const parsed = schema.parse({
    status: firstValue(params.status),
    view: firstValue(params.view),
    attention: firstValue(params.attention),
    refund: firstValue(params.refund),
    from: firstValue(params.from),
    to: firstValue(params.to),
    dates: firstValue(params.dates),
    before: firstValue(params.before),
    discount: firstValue(params.discount),
  });
  const from = day(parsed.from);
  const to = day(parsed.to);
  // YYYY-MM-DD compares as text in calendar order.
  const backwards = from !== null && to !== null && from > to;
  return {
    q: searchQuerySchema.parse(firstValue(params.q)),
    // The old "All orders" link (?view=all) keeps working.
    status: parsed.status ?? (parsed.view === "all" ? "all" : "settled"),
    attention: parsed.attention === "1",
    refund: parsed.refund ?? null,
    from: backwards ? null : from,
    to: backwards ? null : to,
    dates: parsed.dates ?? "created",
    before: parsed.before ?? null,
    discount: parsed.discount ?? null,
  };
}

export function hasFilters(params: AdminOrdersParams): boolean {
  return (
    params.q !== "" ||
    params.status !== "settled" ||
    params.attention ||
    params.refund !== null ||
    params.from !== null ||
    params.to !== null ||
    params.dates !== "created" ||
    params.discount !== null
  );
}

// The list's URL for these filters, without paging unless `before` is given.
export function adminOrdersHref(params: AdminOrdersParams, before: number | null = null): string {
  const query = new URLSearchParams();
  if (params.q !== "") query.set("q", params.q);
  if (params.status !== "settled") query.set("status", params.status);
  if (params.attention) query.set("attention", "1");
  if (params.refund !== null) query.set("refund", params.refund);
  if (params.from !== null) query.set("from", params.from);
  if (params.to !== null) query.set("to", params.to);
  if (params.dates !== "created") query.set("dates", params.dates);
  if (params.discount !== null) query.set("discount", params.discount);
  if (before !== null) query.set("before", String(before));
  const search = query.toString();
  return search ? `${adminOrdersPath}?${search}` : adminOrdersPath;
}

// An all digits query that fits an order number matches that number exactly (AC-1).
export function searchNumber(q: string): number | null {
  if (!/^\d+$/.test(q)) return null;
  const number = Number(q);
  return number >= 1 && number <= maxOrderNumber ? number : null;
}
