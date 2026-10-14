"use client";

import { useState } from "react";

import { sendEmailAgain } from "../actions/emails";
import { ActionDialog, useOrderAction } from "./action-dialog";

// spec 0011, AC-14: a confirm step before a failed email is queued again. A row that gave up may
// already have reached the customer, so that confirm says so first.
export function SendAgainDialog({
  orderNumber,
  emailSendId,
  label,
  mayHaveBeenSent,
}: {
  readonly orderNumber: number;
  readonly emailSendId: string;
  // "Order confirmation", "Shipped", "Refund €12.50".
  readonly label: string;
  readonly mayHaveBeenSent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const action = useOrderAction();
  return (
    <div className="self-start">
      <ActionDialog
        label={
          <>
            Send again <span className="sr-only">({label} email)</span>
          </>
        }
        title={`Send the ${label.toLowerCase()} email again?`}
        description={
          <>
            {mayHaveBeenSent ? (
              <span className="block font-medium text-foreground">
                This email may already have reached the customer. Sending again could deliver it
                twice.
              </span>
            ) : null}
            <span className="block">
              If it was already delivered in the last 24 hours, it will not be sent again.
            </span>
          </>
        }
        submitLabel="Send again"
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) action.setNotice(null);
        }}
        pending={action.pending}
        notice={action.notice}
        onSubmit={() =>
          action.run(() => sendEmailAgain({ orderNumber, emailSendId }), {
            success: "Email queued again",
            onSuccess: () => setOpen(false),
          })
        }
      />
    </div>
  );
}
