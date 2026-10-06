import { createAdminEventLogger } from "@/lib/logger";

// spec 0010, Observability and AC-23: the admin order actions' events, each with the acting
// admin's id. Ids, numbers and amounts only: never an email, a name, an address, a reason, a
// note, a carrier or tracking number. Apart from log.ts so the webhook and cron paths do not
// build an admin logger.

type OrderAdminEvents = {
  "order.shipped": { readonly orderId: string; readonly number: number };
  "order.delivered": { readonly orderId: string; readonly number: number };
  "order.status_reverted": {
    readonly orderId: string;
    readonly number: number;
    readonly from: string;
    readonly to: string;
  };
  "order.tracking_updated": { readonly orderId: string; readonly number: number };
  "order.cancelled": {
    readonly orderId: string;
    readonly number: number;
    readonly from: string;
    readonly refundId: string | null;
  };
  "order.attention_cleared": { readonly orderId: string; readonly number: number };
  "order.note_added": { readonly orderId: string; readonly number: number };
  "order.action_stale": {
    readonly number: number;
    readonly action: string;
    readonly reason: string;
  };
  "refund.created": {
    readonly orderId: string;
    readonly number: number;
    readonly refundId: string;
    readonly amountCents: number;
  };
};

export const logOrderAdminEvent = createAdminEventLogger<OrderAdminEvents>();
