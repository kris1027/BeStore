import type { OrderStatus } from "@/generated/prisma/enums";

// One wording for every page that names an order's status, admin and storefront alike. A customer
// never sees pending_payment or expired (spec 0012, AC-11), so only the admin reads those two.
export const orderStatusLabels: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  expired: "Expired",
};
