"use client";

import { useState } from "react";

import { Price } from "@/components/price";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { centsToInput, parseMoney } from "@/lib/money";

import type { AdminOrderLine } from "../admin-queries";
import { refundOrder } from "../admin-actions";
import {
  type MathOrder,
  refundRequestErrors,
  remainingCents,
  shippingRefundable,
  suggestedCents,
} from "../refund-math";
import { REASON_MAX_LENGTH, reasonField } from "../schemas";
import {
  ActionDialog,
  type FieldErrors,
  firstErrors,
  focusFirst,
  type OrderRef,
  TextField,
  useOrderAction,
} from "./action-dialog";

type LineState = { readonly quantity: string; readonly restock: boolean };

const quantityId = (lineId: string) => `refund-qty-${lineId}`;
const amountId = "refund-amount";
const reasonId = "refund-reason";
const shippingId = "refund-shipping";

// spec 0010, AC-9 to AC-13: pick units per line (with "Return to stock"), delivery, an amount
// that starts at the suggestion and may be lowered, and a reason; then a confirm step repeats
// it all before anything reaches Stripe. The math is the same pure module the action checks
// against, so what the form allows is what the server allows.
export function RefundForm({
  orderRef,
  currency,
  shippingCents,
  lines,
  math,
}: {
  readonly orderRef: OrderRef;
  readonly currency: string;
  readonly shippingCents: number;
  readonly lines: readonly AdminOrderLine[];
  readonly math: MathOrder;
}) {
  const refundable = lines.filter((line) => line.refundableUnits > 0);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [picks, setPicks] = useState<Readonly<Record<string, LineState>>>({});
  const [refundShipping, setRefundShipping] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const action = useOrderAction();

  const remaining = remainingCents(math);
  const offerShipping = shippingRefundable(math);

  function chosen(state: Readonly<Record<string, LineState>> = picks) {
    return refundable.flatMap((line) => {
      const pick = state[line.id];
      const quantity = Number(pick?.quantity ?? "0");
      return Number.isInteger(quantity) && quantity > 0
        ? [{ orderLineId: line.id, quantity, restock: pick?.restock ?? false }]
        : [];
    });
  }

  // A change of lines or delivery sets the amount back to the suggestion.
  function suggest(state: Readonly<Record<string, LineState>>, shipping: boolean) {
    const picked = chosen(state);
    const cents =
      picked.length === 0 && !shipping ? remaining : suggestedCents(math, picked, shipping);
    setAmount(centsToInput(cents, currency));
  }

  function reset(next: boolean) {
    setOpen(next);
    if (!next) return;
    setStep("form");
    setPicks({});
    setRefundShipping(false);
    setAmount(centsToInput(remaining, currency));
    setReason("");
    setErrors({});
    action.setNotice(null);
  }

  function setPick(lineId: string, change: Partial<LineState>) {
    const next = {
      ...picks,
      [lineId]: { quantity: "0", restock: false, ...picks[lineId], ...change },
    };
    setPicks(next);
    if (change.quantity !== undefined) suggest(next, refundShipping);
  }

  function validate(): FieldErrors {
    const found: Record<string, string> = {};
    for (const line of refundable) {
      const text = picks[line.id]?.quantity ?? "0";
      const quantity = Number(text);
      if (text.trim() === "" || !Number.isInteger(quantity) || quantity < 0) {
        found[`lines.${line.id}`] = "Enter a whole number.";
      }
    }
    const cents = parseMoney(amount, currency);
    if (!cents.ok) found.amount = "Enter an amount like 12.50.";
    const reasonResult = reasonField.safeParse(reason);
    if (!reasonResult.success) found.reason = reasonResult.error.issues[0]?.message ?? "";
    if (Object.keys(found).length === 0 && cents.ok) {
      const server = refundRequestErrors(math, {
        lines: chosen(),
        refundShipping,
        amountCents: cents.cents,
      });
      if (server) Object.assign(found, firstErrors(server));
    }
    return found;
  }

  function focusErrors(found: FieldErrors) {
    focusFirst([
      ...refundable.filter((line) => found[`lines.${line.id}`]).map((line) => quantityId(line.id)),
      ...(found.refundShipping ? [shippingId] : []),
      ...(found.amount ? [amountId] : []),
      ...(found.reason ? [reasonId] : []),
    ]);
  }

  function submit() {
    if (step === "form") {
      const found = validate();
      setErrors(found);
      if (Object.keys(found).length > 0) {
        focusErrors(found);
        return;
      }
      action.setNotice(null);
      setStep("confirm");
      return;
    }
    const picked = chosen();
    action.run(
      () =>
        refundOrder({
          ...orderRef,
          lines: picked,
          refundShipping,
          amount,
          reason,
        }),
      {
        success: "Refund sent to Stripe",
        onSuccess: () => setOpen(false),
        onFields: (fields) => {
          const found = firstErrors(fields);
          setErrors(found);
          setStep("form");
          focusErrors(found);
          return true;
        },
      },
    );
  }

  const picked = chosen();
  const cents = parseMoney(amount, currency);

  return (
    <ActionDialog
      label="Refund"
      title={step === "form" ? "Refund" : "Confirm the refund"}
      description={
        step === "form" ? (
          <>
            Up to <Price cents={remaining} currency={currency} /> is left to refund. With no items
            and no delivery chosen, it is a goodwill refund of any amount up to that.
          </>
        ) : (
          "Stripe sends the money back to the customer's card. This cannot be undone."
        )
      }
      submitLabel={step === "form" ? "Review refund" : "Refund now"}
      submitVariant={step === "form" ? "default" : "destructive"}
      open={open}
      onOpenChange={reset}
      pending={action.pending}
      notice={action.notice}
      onSubmit={submit}
      {...(step === "confirm" ? { onBack: () => setStep("form") } : {})}
    >
      {step === "form" ? (
        <>
          {refundable.length > 0 ? (
            <FieldSet>
              <FieldLegend variant="label">Items</FieldLegend>
              {refundable.map((line) => {
                const pick = picks[line.id];
                const quantity = Number(pick?.quantity ?? "0");
                const error = errors[`lines.${line.id}`];
                const restockId = `refund-restock-${line.id}`;
                const overStock =
                  pick?.restock === true && quantity > line.restockableUnits
                    ? `Only ${line.restockableUnits} can go back to stock: the sale took fewer, or they came back already.`
                    : null;
                const name = `${line.productName}${line.variantLabel ? ` (${line.variantLabel})` : ""}`;
                return (
                  <div key={line.id} className="flex flex-col gap-2 rounded-md border p-3">
                    <Field data-invalid={error ? true : undefined}>
                      <FieldLabel htmlFor={quantityId(line.id)}>Units of {name}</FieldLabel>
                      <Input
                        id={quantityId(line.id)}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={line.refundableUnits}
                        className="max-w-28"
                        value={pick?.quantity ?? "0"}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={[
                          `${quantityId(line.id)}-description`,
                          error ? `${quantityId(line.id)}-error` : null,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onChange={(event) => setPick(line.id, { quantity: event.target.value })}
                      />
                      <FieldDescription id={`${quantityId(line.id)}-description`}>
                        {line.refundableUnits} of {line.quantity} can still be refunded.
                      </FieldDescription>
                      <FieldError id={`${quantityId(line.id)}-error`}>{error}</FieldError>
                    </Field>
                    {quantity > 0 ? (
                      <Field orientation="horizontal">
                        <Checkbox
                          id={restockId}
                          aria-labelledby={`${restockId}-label`}
                          checked={pick?.restock ?? false}
                          aria-describedby={overStock ? `${restockId}-warning` : undefined}
                          onCheckedChange={(checked) => setPick(line.id, { restock: checked })}
                        />
                        <FieldLabel
                          id={`${restockId}-label`}
                          htmlFor={restockId}
                          className="font-normal"
                        >
                          Return to stock
                        </FieldLabel>
                      </Field>
                    ) : null}
                    {overStock ? (
                      <p id={`${restockId}-warning`} className="text-sm text-muted-foreground">
                        {overStock}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </FieldSet>
          ) : null}
          {offerShipping ? (
            <Field orientation="horizontal" data-invalid={errors.refundShipping ? true : undefined}>
              <Checkbox
                id={shippingId}
                aria-labelledby={`${shippingId}-label`}
                checked={refundShipping}
                aria-describedby={errors.refundShipping ? `${shippingId}-error` : undefined}
                onCheckedChange={(checked) => {
                  setRefundShipping(checked);
                  suggest(picks, checked);
                }}
              />
              <FieldLabel id={`${shippingId}-label`} htmlFor={shippingId} className="font-normal">
                Refund delivery (<Price cents={shippingCents} currency={currency} />)
              </FieldLabel>
              <FieldError id={`${shippingId}-error`}>{errors.refundShipping}</FieldError>
            </Field>
          ) : null}
          <TextField
            id={amountId}
            label={`Amount (${currency})`}
            value={amount}
            onChange={setAmount}
            error={errors.amount}
            description="Starts at what the chosen items and delivery are worth. You can lower it."
          />
          <TextField
            id={reasonId}
            label="Reason"
            value={reason}
            onChange={setReason}
            error={errors.reason}
            description="For the order history. Never sent to the customer or to Stripe."
            multiline
            maxLength={REASON_MAX_LENGTH}
          />
        </>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Amount</dt>
          <dd className="font-semibold">
            {cents.ok ? <Price cents={cents.cents} currency={currency} /> : amount}
          </dd>
          <dt className="text-muted-foreground">Items</dt>
          <dd>
            {picked.length === 0 ? (
              "None (goodwill refund)"
            ) : (
              <ul className="flex flex-col gap-1">
                {picked.map((pick) => {
                  const line = refundable.find((entry) => entry.id === pick.orderLineId);
                  return (
                    <li key={pick.orderLineId}>
                      {pick.quantity} × {line?.productName}
                      {line?.variantLabel ? ` (${line.variantLabel})` : ""}
                      {pick.restock ? ", back to stock" : ", not back to stock"}
                    </li>
                  );
                })}
              </ul>
            )}
          </dd>
          <dt className="text-muted-foreground">Delivery</dt>
          <dd>{refundShipping ? "Refunded" : "Not refunded"}</dd>
          <dt className="text-muted-foreground">Reason</dt>
          <dd className="whitespace-pre-wrap">{reason.trim()}</dd>
        </dl>
      )}
    </ActionDialog>
  );
}
