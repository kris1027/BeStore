import { TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/generated/prisma/enums";

export const orderStatusLabels: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  expired: "Expired",
};

export function OrderStatusBadge({ status }: { readonly status: OrderStatus }) {
  const variant =
    status === "paid" || status === "shipped" || status === "delivered"
      ? "secondary"
      : status === "cancelled"
        ? "destructive"
        : "outline";
  return <Badge variant={variant}>{orderStatusLabels[status]}</Badge>;
}

export function NeedsAttentionBadge() {
  return (
    <Badge variant="destructive">
      <TriangleAlertIcon data-icon="inline-start" aria-hidden="true" />
      Needs attention
    </Badge>
  );
}
