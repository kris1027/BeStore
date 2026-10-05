"use client";

import { useState } from "react";

import { Price } from "@/components/price";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";

import type { AdminOrderLine } from "../admin-queries";
import { cancelOrder } from "../admin-actions";
import { REASON_MAX_LENGTH, reasonField } from "../schemas";
import {
  ActionDialog,
  firstErrors,
  focusFirst,
  type OrderRef,
  TextField,
  useOrderAction,
} from "./action-dialog";

const reasonId = "cancel-reason";

// spec 0010, AC-14 (a paid order: refund everything left, every unit listed with "Return to
// stock" ticked) and AC-15 (an unpaid order: Stripe's session is closed first). The dialog is
// the confirm step: the amount is fixed, only the reason and the restock ticks are chosen.
export function CancelDialog({
  orderRef,
  paid,
  currency,
  remainingCents,
  lines,
}: {
  readonly orderRef: OrderRef;
  readonly paid: boolean;
  readonly currency: string;
  readonly remainingCents: number;
  readonly lines: readonly AdminOrderLine[];
}) {
  const refundable = lines.filter((line) => line.refundableUnits > 0);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const action = useOrderAction();

  function reset(next: boolean) {
    setOpen(next);
    if (!next) return;
    setReason("");
    setRestock(new Set(refundable.map((line) => line.id)));
    setError(undefined);
    action.setNotice(null);
  }

  function submit() {
    const parsed = reasonField.safeParse(reason);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      focusFirst([reasonId]);
      return;
    }
    setError(undefined);
    action.run(
      () => cancelOrder({ ...orderRef, reason, restockLineIds: paid ? [...restock] : [] }),
      {
        success: "Order cancelled",
        onSuccess: () => setOpen(false),
        onFields: (fields) => {
          const message = firstErrors(fields).reason;
          if (!message) return false;
          setError(message);
          focusFirst([reasonId]);
          return true;
        },
      },
    );
  }

  return (
    <ActionDialog
      label={paid ? "Cancel and refund" : "Cancel order"}
      variant="destructive"
      submitVariant="destructive"
      title={
        paid
          ? `Cancel order #${orderRef.orderNumber} and refund it?`
          : `Cancel order #${orderRef.orderNumber}?`
      }
      description={
        paid ? (
          <>
            The customer gets back <Price cents={remainingCents} currency={currency} />, everything
            not refunded yet. This cannot be undone.
          </>
        ) : (
          "The customer's checkout is closed first, so it can no longer be paid."
        )
      }
      submitLabel={paid ? "Cancel and refund" : "Cancel order"}
      open={open}
      onOpenChange={reset}
      pending={action.pending}
      notice={action.notice}
      onSubmit={submit}
    >
      {paid && refundable.length > 0 ? (
        <FieldSet>
          <FieldLegend variant="label">Return to stock</FieldLegend>
          {refundable.map((line) => {
            const id = `cancel-restock-${line.id}`;
            return (
              <Field key={line.id} orientation="horizontal">
                <Checkbox
                  id={id}
                  aria-labelledby={`${id}-label`}
                  checked={restock.has(line.id)}
                  onCheckedChange={(checked) =>
                    setRestock((old) => {
                      const next = new Set(old);
                      if (checked) next.add(line.id);
                      else next.delete(line.id);
                      return next;
                    })
                  }
                />
                <FieldLabel id={`${id}-label`} htmlFor={id} className="font-normal">
                  {line.refundableUnits} × {line.productName}
                  {line.variantLabel ? ` (${line.variantLabel})` : ""}
                </FieldLabel>
              </Field>
            );
          })}
        </FieldSet>
      ) : null}
      <TextField
        id={reasonId}
        label="Reason"
        value={reason}
        onChange={setReason}
        error={error}
        description="For the order history. Never sent to the customer or to Stripe."
        multiline
        maxLength={REASON_MAX_LENGTH}
      />
    </ActionDialog>
  );
}
