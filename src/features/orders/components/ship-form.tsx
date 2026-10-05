"use client";

import { TruckIcon } from "lucide-react";
import { useState } from "react";

import { editTracking, markShipped } from "../admin-actions";
import { TRACKING_MAX_LENGTH, trackingSchema } from "../schemas";
import {
  ActionDialog,
  type FieldErrors,
  firstErrors,
  focusFirst,
  type OrderRef,
  TextField,
  useOrderAction,
} from "./action-dialog";

const fieldIds = { carrier: "ship-carrier", trackingNumber: "ship-tracking" } as const;

// spec 0010, AC-4 ("Mark shipped", both fields optional) and AC-7 ("Edit tracking", which the
// action refuses when nothing changed). Undo keeps carrier and tracking, so shipping again
// starts from them.
export function ShipForm({
  mode,
  orderRef,
  carrier,
  trackingNumber,
}: {
  readonly mode: "ship" | "edit";
  readonly orderRef: OrderRef;
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ carrier: "", trackingNumber: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const action = useOrderAction();

  function reset(next: boolean) {
    setOpen(next);
    if (!next) return;
    setValues({ carrier: carrier ?? "", trackingNumber: trackingNumber ?? "" });
    setErrors({});
    action.setNotice(null);
  }

  function show(fields: Readonly<Record<string, readonly string[]>>) {
    const found = firstErrors(fields);
    setErrors(found);
    focusFirst(
      (Object.keys(fieldIds) as (keyof typeof fieldIds)[])
        .filter((key) => found[key])
        .map((key) => fieldIds[key]),
    );
    return Object.keys(found).some((key) => key in fieldIds);
  }

  function submit() {
    const payload = { ...orderRef, ...values };
    const parsed = trackingSchema.safeParse(payload);
    if (!parsed.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        (fields[issue.path.join(".")] ??= []).push(issue.message);
      }
      show(fields);
      return;
    }
    setErrors({});
    action.run(() => (mode === "ship" ? markShipped(payload) : editTracking(payload)), {
      success: mode === "ship" ? "Order marked shipped" : "Tracking updated",
      onSuccess: () => setOpen(false),
      onFields: show,
    });
  }

  return (
    <ActionDialog
      label={
        mode === "ship" ? (
          <>
            <TruckIcon data-icon="inline-start" aria-hidden="true" />
            Mark shipped
          </>
        ) : (
          "Edit tracking"
        )
      }
      variant={mode === "ship" ? "default" : "outline"}
      title={mode === "ship" ? `Mark order #${orderRef.orderNumber} shipped` : "Edit tracking"}
      description={
        mode === "ship"
          ? "Both fields are optional. They show in the order history."
          : "Change the carrier or the tracking number. The history keeps the old values."
      }
      submitLabel={mode === "ship" ? "Mark shipped" : "Save tracking"}
      open={open}
      onOpenChange={reset}
      pending={action.pending}
      notice={action.notice}
      onSubmit={submit}
    >
      <TextField
        id={fieldIds.carrier}
        label="Carrier"
        value={values.carrier}
        onChange={(carrier) => setValues((old) => ({ ...old, carrier }))}
        error={errors.carrier}
        maxLength={TRACKING_MAX_LENGTH}
      />
      <TextField
        id={fieldIds.trackingNumber}
        label="Tracking number"
        value={values.trackingNumber}
        onChange={(trackingNumber) => setValues((old) => ({ ...old, trackingNumber }))}
        error={errors.trackingNumber}
        maxLength={TRACKING_MAX_LENGTH}
      />
    </ActionDialog>
  );
}
