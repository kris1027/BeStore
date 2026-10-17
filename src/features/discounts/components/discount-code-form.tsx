"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Controller,
  type FieldError as FormFieldError,
  useForm,
  type UseFormRegisterReturn,
  useWatch,
} from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";

import { createDiscountCode, type DiscountFormError } from "../actions/create-discount-code";
import { updateDiscountCode } from "../actions/update-discount-code";
import { adminDiscountPath } from "../paths";
import {
  type DiscountCodeInput,
  type DiscountCodeValues,
  discountCodeFieldsSchema,
  discountFields,
  discountMessages,
  emptyDiscountValues,
  NOTE_MAX_LENGTH,
} from "../schemas";

const notices = {
  locked_fields: "This code has been used, so its code, type and value can't change.",
  stale: "This code changed since you opened it. Reload to see the latest.",
  not_found: "This code no longer exists. Go back to the codes.",
} as const;

export type DiscountCodeFormCode = {
  readonly id: string;
  readonly values: DiscountCodeValues;
  readonly updatedAt: string;
  // AC-12: code, type and value are read only once the code has been used.
  readonly locked: boolean;
};

// spec 0014, AC-11 and AC-12: one form for new and edit. On edit, keyed by updated_at so a save
// that lands remounts it with the stored values.
export function DiscountCodeForm({
  currency,
  timeZone,
  code,
}: {
  readonly currency: string;
  readonly timeZone: string;
  readonly code?: DiscountCodeFormCode;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const schema = useMemo(() => discountCodeFieldsSchema(currency, timeZone), [currency, timeZone]);
  const form = useForm<DiscountCodeValues, unknown, DiscountCodeInput>({
    resolver: zodResolver(schema),
    defaultValues: code?.values ?? emptyDiscountValues,
  });
  const { errors } = form.formState;
  const type = useWatch({ control: form.control, name: "type" });
  const locked = code?.locked ?? false;

  function showError(error: DiscountFormError) {
    switch (error.code) {
      case "validation":
        discountFields
          .filter((field) => error.fields[field] !== undefined)
          .forEach((field, index) => {
            form.setError(
              field,
              { type: "server", message: error.fields[field] },
              { shouldFocus: index === 0 },
            );
          });
        return;
      case "code_taken":
        form.setError(
          "code",
          { type: "server", message: discountMessages.codeTaken },
          { shouldFocus: true },
        );
        return;
      default:
        setNotice(notices[error.code]);
    }
  }

  // The raw values go to the server, which parses exactly what was typed.
  const onSubmit = form.handleSubmit(() => {
    setNotice(null);
    const values = form.getValues();
    startTransition(async () => {
      if (code === undefined) {
        const result = await createDiscountCode(values);
        if (!result.ok) return showError(result.error);
        toast.add({
          title: "Code added",
          description: values.code.trim().toUpperCase(),
          type: "success",
        });
        router.push(adminDiscountPath(result.data.id));
        return;
      }
      const result = await updateDiscountCode({
        ...values,
        id: code.id,
        loadedUpdatedAt: code.updatedAt,
      });
      if (!result.ok) return showError(result.error);
      toast.add({ title: "Code saved", type: "success" });
      router.refresh();
    });
  });

  const lockedHint = locked ? "Locked after first use." : undefined;

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Promo code" className="flex flex-col gap-6">
      <FieldGroup>
        <FormNotice message={notice} />
        <TextField
          id="discount-code"
          label="Code"
          hint={lockedHint ?? "3 to 32 letters, digits or hyphens, like SUMMER10."}
          error={errors.code}
          readOnly={locked}
          className="uppercase"
          autoCapitalize="characters"
          registration={form.register("code")}
        />
        <FieldSet>
          <FieldLegend variant="label">Type</FieldLegend>
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <RadioGroup
                value={field.value}
                onValueChange={(value) => field.onChange(value)}
                disabled={locked}
                aria-describedby={
                  errors.type ? "discount-type-error" : locked ? "discount-type-hint" : undefined
                }
              >
                <Field orientation="horizontal" data-invalid={errors.type ? true : undefined}>
                  <RadioGroupItem
                    value="percent"
                    id="discount-type-percent"
                    ref={field.ref}
                    aria-invalid={errors.type ? true : undefined}
                  />
                  <FieldLabel htmlFor="discount-type-percent" className="font-normal">
                    Percent off the items
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal" data-invalid={errors.type ? true : undefined}>
                  <RadioGroupItem
                    value="fixed_amount"
                    id="discount-type-fixed"
                    aria-invalid={errors.type ? true : undefined}
                  />
                  <FieldLabel htmlFor="discount-type-fixed" className="font-normal">
                    Fixed amount off the items
                  </FieldLabel>
                </Field>
              </RadioGroup>
            )}
          />
          {errors.type ? (
            <FieldError id="discount-type-error" errors={[errors.type]} />
          ) : locked ? (
            <FieldDescription id="discount-type-hint">{lockedHint}</FieldDescription>
          ) : null}
        </FieldSet>
        <TextField
          id="discount-value"
          label={type === "fixed_amount" ? `Amount off (${currency})` : "Percent off"}
          hint={
            lockedHint ??
            (type === "fixed_amount"
              ? "Like 5.00. Delivery is never discounted."
              : "A whole number from 1 to 100. Delivery is never discounted.")
          }
          error={errors.value}
          readOnly={locked}
          inputMode={type === "fixed_amount" ? "decimal" : "numeric"}
          registration={form.register("value")}
        />
        <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2">
          <TextField
            id="discount-starts-at"
            label="Starts at (optional)"
            type="datetime-local"
            hint={`Store time (${timeZone}). Empty starts now.`}
            error={errors.startsAt}
            registration={form.register("startsAt")}
          />
          <TextField
            id="discount-ends-at"
            label="Ends at (optional)"
            type="datetime-local"
            hint={`Store time (${timeZone}). Empty never ends.`}
            error={errors.endsAt}
            registration={form.register("endsAt")}
          />
        </div>
        <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2">
          <TextField
            id="discount-max-redemptions"
            label="Total use limit (optional)"
            inputMode="numeric"
            hint="Paid orders, plus checkouts still on the payment page."
            error={errors.maxRedemptions}
            registration={form.register("maxRedemptions")}
          />
          <TextField
            id="discount-per-customer"
            label="Per customer limit (optional)"
            inputMode="numeric"
            hint="Counted by order email."
            error={errors.perCustomerLimit}
            registration={form.register("perCustomerLimit")}
          />
        </div>
        <TextField
          id="discount-min-subtotal"
          label={`Minimum subtotal (optional, ${currency})`}
          inputMode="decimal"
          hint="The items before the discount, like 50.00."
          error={errors.minSubtotal}
          registration={form.register("minSubtotal")}
        />
        <Field orientation="horizontal">
          <Controller
            control={form.control}
            name="active"
            render={({ field }) => (
              <Checkbox
                id="discount-active"
                name={field.name}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                inputRef={field.ref}
                aria-describedby="discount-active-hint"
              />
            )}
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="discount-active">Active</FieldLabel>
            <FieldDescription id="discount-active-hint">
              Customers can use an active code between its start and end.
            </FieldDescription>
          </div>
        </Field>
        <Field data-invalid={errors.note ? true : undefined}>
          <FieldLabel htmlFor="discount-note">Note (optional)</FieldLabel>
          <Textarea
            id="discount-note"
            rows={3}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={
              errors.note ? "discount-note-hint discount-note-error" : "discount-note-hint"
            }
            {...form.register("note")}
          />
          <FieldDescription id="discount-note-hint">
            Only admins see it. Up to {NOTE_MAX_LENGTH} characters.
          </FieldDescription>
          <FieldError id="discount-note-error" errors={[errors.note]} />
        </Field>
      </FieldGroup>
      <Button type="submit" className="self-start" disabled={pending || !hydrated}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {code === undefined ? "Add code" : "Save code"}
      </Button>
    </form>
  );
}

function TextField({
  id,
  label,
  hint,
  error,
  registration,
  ...input
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error: FormFieldError | undefined;
  readonly registration: UseFormRegisterReturn;
  readonly type?: "text" | "datetime-local";
  readonly inputMode?: "numeric" | "decimal";
  readonly readOnly?: boolean;
  readonly className?: string;
  readonly autoCapitalize?: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={input.type ?? "text"}
        inputMode={input.inputMode}
        readOnly={input.readOnly}
        autoComplete="off"
        autoCapitalize={input.autoCapitalize}
        className={input.className}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...registration}
      />
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
      <FieldError id={errorId} errors={[error]} />
    </Field>
  );
}
