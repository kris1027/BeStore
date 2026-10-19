import type { StoreDays } from "./period";

export const dashboardPath = "/admin";

// The catalog's admin page of a product, by id (spec 0009).
export function adminProductPath(id: string): string {
  return `/admin/products/${id}`;
}

// spec 0015, AC-13: every order paid in the window, whatever its status now.
export function paidOrdersPath(range: StoreDays): string {
  const query = new URLSearchParams({
    status: "all",
    dates: "paid",
    from: range.firstDay,
    to: range.lastDay,
  });
  return `/admin/orders?${query.toString()}`;
}
