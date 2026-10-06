import { Badge } from "@/components/ui/badge";

import type { RefundState } from "../refund-math";

export const refundStateLabels: Record<RefundState, string> = {
  none: "Not refunded",
  partial: "Partly refunded",
  full: "Fully refunded",
};

// spec 0010, AC-21: from refunded_cents against total_cents.
export function RefundStateBadge({ state }: { readonly state: RefundState }) {
  return (
    <Badge variant={state === "none" ? "outline" : "secondary"}>{refundStateLabels[state]}</Badge>
  );
}
