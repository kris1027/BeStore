"use client";

import { useState } from "react";

import type { OrderStatus } from "@/generated/prisma/enums";

import { resolveAttention } from "../actions/notes";
import { markDelivered, undoStatus } from "../actions/status";
import { NOTE_MAX_LENGTH, noteField, REASON_MAX_LENGTH, reasonField } from "../schemas";
import {
  ActionDialog,
  firstErrors,
  focusFirst,
  type OrderRef,
  TextField,
  useOrderAction,
} from "./action-dialog";
import { orderStatusLabels } from "./order-status-badge";

type Kind = "undo" | "resolve";

const copy = {
  undo: {
    id: "undo-reason",
    field: "reason",
    label: "Reason",
    submit: "Undo",
    success: "Status changed back",
    max: REASON_MAX_LENGTH,
    schema: reasonField,
  },
  resolve: {
    id: "resolve-note",
    field: "note",
    label: "What did you do?",
    submit: "Mark resolved",
    success: "Marked resolved",
    max: NOTE_MAX_LENGTH,
    schema: noteField,
  },
} as const;

// spec 0010, AC-6 (Undo needs a reason) and AC-20 (Mark resolved needs a note). The text lands
// in the order history.
export function ReasonDialog({
  kind,
  orderRef,
  status,
}: {
  readonly kind: Kind;
  readonly orderRef: OrderRef;
  readonly status: OrderStatus;
}) {
  const text = copy[kind];
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const action = useOrderAction();
  const back: OrderStatus = status === "delivered" ? "shipped" : "paid";

  function reset(next: boolean) {
    setOpen(next);
    if (!next) return;
    setValue("");
    setError(undefined);
    action.setNotice(null);
  }

  function submit() {
    const parsed = text.schema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      focusFirst([text.id]);
      return;
    }
    setError(undefined);
    const call =
      kind === "undo"
        ? () => undoStatus({ ...orderRef, reason: value })
        : () => resolveAttention({ ...orderRef, note: value });
    action.run(call, {
      success: text.success,
      onSuccess: () => setOpen(false),
      onFields: (fields) => {
        const message = firstErrors(fields)[text.field];
        if (!message) return false;
        setError(message);
        focusFirst([text.id]);
        return true;
      },
    });
  }

  return (
    <ActionDialog
      label={kind === "undo" ? `Undo: back to ${orderStatusLabels[back]}` : "Mark resolved"}
      title={
        kind === "undo" ? `Move the order back to ${orderStatusLabels[back]}?` : "Mark resolved"
      }
      description={
        kind === "undo"
          ? "Say why, for the order history. Carrier and tracking are kept."
          : "Clears the needs attention flag. Your note goes in the order history."
      }
      submitLabel={text.submit}
      open={open}
      onOpenChange={reset}
      pending={action.pending}
      notice={action.notice}
      onSubmit={submit}
    >
      <TextField
        id={text.id}
        label={text.label}
        value={value}
        onChange={setValue}
        error={error}
        multiline
        maxLength={text.max}
      />
    </ActionDialog>
  );
}

// spec 0010, AC-5: a confirm, no fields.
export function DeliverDialog({ orderRef }: { readonly orderRef: OrderRef }) {
  const [open, setOpen] = useState(false);
  const action = useOrderAction();
  return (
    <ActionDialog
      label="Mark delivered"
      variant="default"
      title={`Mark order #${orderRef.orderNumber} delivered?`}
      description="Only do this once the parcel has arrived. You can undo it."
      submitLabel="Mark delivered"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) action.setNotice(null);
      }}
      pending={action.pending}
      notice={action.notice}
      onSubmit={() =>
        action.run(() => markDelivered(orderRef), {
          success: "Order marked delivered",
          onSuccess: () => setOpen(false),
        })
      }
    />
  );
}
