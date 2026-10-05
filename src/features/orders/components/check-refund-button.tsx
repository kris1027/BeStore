"use client";

import { RefreshCwIcon } from "lucide-react";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";

import { checkRefundWithStripe } from "../admin-actions";
import { useOrderAction } from "./action-dialog";

// spec 0010, AC-17: asks Stripe now instead of waiting for the webhook or the daily sync.
export function CheckRefundButton({
  orderNumber,
  refundId,
}: {
  readonly orderNumber: number;
  readonly refundId: string;
}) {
  const hydrated = useHydrated();
  const action = useOrderAction();
  return (
    <div className="flex flex-col gap-2">
      <FormNotice message={action.notice} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={action.pending || !hydrated}
        onClick={() =>
          action.run(() => checkRefundWithStripe({ orderNumber, refundId }), {
            success: "Checked with Stripe",
          })
        }
      >
        {action.pending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
        )}
        Check with Stripe
      </Button>
    </div>
  );
}
