import type { AdminOrderDetail } from "../admin-queries";
import { refundInProgressMessage } from "../messages";
import type { OrderRef } from "./action-dialog";
import { CancelDialog } from "./cancel-dialog";
import { DeliverDialog, ReasonDialog } from "./reason-dialog";
import { RefundForm } from "./refund-form";
import { ShipForm } from "./ship-form";

// spec 0010, AC-21: only the actions the order's status allows right now (allowedActions). Each
// action checks the same rule again under the order lock.
export function OrderActionsPanel({ order }: { readonly order: AdminOrderDetail }) {
  const orderRef: OrderRef = { orderNumber: order.number, expectedUpdatedAt: order.updatedAt };
  const { allowed } = order;
  const any =
    allowed.ship ||
    allowed.deliver ||
    allowed.undo ||
    allowed.editTracking ||
    allowed.refund ||
    allowed.cancel ||
    allowed.resolve;

  return (
    <div className="flex flex-col gap-3">
      {order.refundInFlight ? (
        <p role="status" className="text-sm text-muted-foreground">
          {refundInProgressMessage} Actions come back once Stripe answers.
        </p>
      ) : null}
      {any ? (
        <div className="flex flex-wrap gap-2">
          {allowed.ship ? (
            <ShipForm
              mode="ship"
              orderRef={orderRef}
              carrier={order.carrier}
              trackingNumber={order.trackingNumber}
            />
          ) : null}
          {allowed.deliver ? <DeliverDialog orderRef={orderRef} /> : null}
          {allowed.editTracking ? (
            <ShipForm
              mode="edit"
              orderRef={orderRef}
              carrier={order.carrier}
              trackingNumber={order.trackingNumber}
            />
          ) : null}
          {allowed.refund ? (
            <RefundForm
              orderRef={orderRef}
              currency={order.currency}
              shippingCents={order.shippingCents}
              lines={order.lines}
              math={order.math}
            />
          ) : null}
          {allowed.resolve ? (
            <ReasonDialog kind="resolve" orderRef={orderRef} status={order.status} />
          ) : null}
          {allowed.undo ? (
            <ReasonDialog kind="undo" orderRef={orderRef} status={order.status} />
          ) : null}
          {allowed.cancel ? (
            <CancelDialog
              orderRef={orderRef}
              paid={order.status === "paid"}
              currency={order.currency}
              remainingCents={order.remainingCents}
              lines={order.lines}
            />
          ) : null}
        </div>
      ) : order.refundInFlight ? null : (
        <p className="text-sm text-muted-foreground">No actions for an order in this status.</p>
      )}
    </div>
  );
}
