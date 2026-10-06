import { Price } from "@/components/price";
import { Badge } from "@/components/ui/badge";
import { type DateFormat, formatDateTime } from "@/lib/dates";

import type { AdminRefund } from "../admin-queries";
import { CheckRefundButton } from "./check-refund-button";

const statusLabels: Record<AdminRefund["status"], string> = {
  pending: "Pending",
  succeeded: "Succeeded",
  failed: "Failed",
};

// spec 0010, AC-13 and AC-21: every refund, newest first, with who asked, why, and per line the
// units refunded and the units that went back to stock.
export function RefundsSection({
  orderNumber,
  refunds,
  currency,
  dateFormat,
}: {
  readonly orderNumber: number;
  readonly refunds: readonly AdminRefund[];
  readonly currency: string;
  readonly dateFormat: DateFormat;
}) {
  if (refunds.length === 0) {
    return <p className="text-sm text-muted-foreground">No refunds yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-4">
      {refunds.map((refund) => (
        <li key={refund.id} className="flex flex-col gap-2 border-l-2 pl-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              <Price cents={refund.amountCents} currency={currency} />
            </span>
            <Badge
              variant={
                refund.status === "failed"
                  ? "destructive"
                  : refund.status === "pending"
                    ? "outline"
                    : "secondary"
              }
            >
              {statusLabels[refund.status]}
            </Badge>
            {refund.includesShipping ? (
              <span className="text-xs text-muted-foreground">includes delivery</span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            <time dateTime={refund.createdAt.toISOString()}>
              {formatDateTime(refund.createdAt, dateFormat)}
            </time>{" "}
            · {refund.adminName ?? "Stripe dashboard"}
          </p>
          {refund.reason ? <p className="text-sm whitespace-pre-wrap">{refund.reason}</p> : null}
          {refund.lines.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {refund.lines.map((line) => (
                <li key={line.id}>
                  {line.quantity} × {line.productName}
                  {line.variantLabel ? ` (${line.variantLabel})` : ""}{" "}
                  <span className="text-muted-foreground">
                    {line.restock
                      ? `· ${line.returnedQuantity} of ${line.quantity} back to stock`
                      : "· not returned to stock"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {refund.canCheck ? (
            <CheckRefundButton orderNumber={orderNumber} refundId={refund.id} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
