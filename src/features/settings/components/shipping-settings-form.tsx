"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { useStoreFormat } from "@/components/store-format-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { fractionDigits } from "@/lib/money";

import { updateShippingSettings } from "../actions/update-shipping-settings";
import {
  type ShippingSettingsField,
  shippingSettingsSchema,
  type ShippingSettingsValues,
} from "../schemas";

const noSubscription = () => () => {};

const fieldIds: Record<ShippingSettingsField, string> = {
  deliveryFee: "settings-delivery-fee",
  freeDeliveryFrom: "settings-free-delivery-from",
};

// spec 0007, AC-10: the delivery fee and the free delivery threshold.
export function ShippingSettingsForm({
  defaultValues,
}: {
  readonly defaultValues: ShippingSettingsValues;
}) {
  const { currency } = useStoreFormat();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  // Until React takes over, Save stays disabled: the fields get their values on hydration, and a
  // native submit would send them as a GET query.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const schema = useMemo(() => shippingSettingsSchema(currency), [currency]);
  const form = useForm({ resolver: zodResolver(schema), defaultValues });
  const { errors } = form.formState;
  const freeDelivery = useWatch({ control: form.control, name: "freeDelivery" });
  const example = (9.99).toFixed(fractionDigits(currency));

  // The server parses the raw strings itself, so the form sends what was typed, not the cents.
  const onSubmit = form.handleSubmit(() => {
    setSaved(false);
    const values = form.getValues();
    startTransition(async () => {
      const result = await updateShippingSettings(values);
      if (result.ok) {
        form.reset(values);
        setSaved(true);
        return;
      }
      const invalid = (Object.keys(fieldIds) as ShippingSettingsField[]).filter(
        (field) => result.error.fields[field] !== undefined,
      );
      invalid.forEach((field, index) => {
        form.setError(
          field,
          { type: "server", message: result.error.fields[field] },
          { shouldFocus: index === 0 },
        );
      });
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Shipping settings">
      <FieldGroup>
        <FormNotice message={saved ? "Shipping settings saved." : null} tone="info" />
        <Field data-invalid={errors.deliveryFee ? true : undefined}>
          <FieldLabel htmlFor={fieldIds.deliveryFee}>Delivery fee</FieldLabel>
          <Input
            id={fieldIds.deliveryFee}
            inputMode="decimal"
            autoComplete="off"
            className="max-w-48"
            aria-invalid={errors.deliveryFee ? true : undefined}
            aria-describedby={
              errors.deliveryFee ? `${fieldIds.deliveryFee}-error` : `${fieldIds.deliveryFee}-hint`
            }
            {...form.register("deliveryFee")}
          />
          {errors.deliveryFee ? (
            <FieldError id={`${fieldIds.deliveryFee}-error`} errors={[errors.deliveryFee]} />
          ) : (
            <FieldDescription id={`${fieldIds.deliveryFee}-hint`}>
              In {currency}, like {example}. Charged once per order; 0 makes delivery always free.
            </FieldDescription>
          )}
        </Field>
        <Field orientation="horizontal">
          <Controller
            control={form.control}
            name="freeDelivery"
            render={({ field }) => (
              <Checkbox
                id="settings-free-delivery"
                name={field.name}
                checked={field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked);
                  if (!checked) form.clearErrors("freeDeliveryFrom");
                }}
                onBlur={field.onBlur}
                inputRef={field.ref}
              />
            )}
          />
          <FieldLabel htmlFor="settings-free-delivery">Offer free delivery</FieldLabel>
        </Field>
        <Field
          data-invalid={freeDelivery && errors.freeDeliveryFrom ? true : undefined}
          data-disabled={freeDelivery ? undefined : true}
        >
          <FieldLabel htmlFor={fieldIds.freeDeliveryFrom}>Free delivery from</FieldLabel>
          <Input
            id={fieldIds.freeDeliveryFrom}
            inputMode="decimal"
            autoComplete="off"
            className="max-w-48"
            disabled={!freeDelivery}
            aria-invalid={freeDelivery && errors.freeDeliveryFrom ? true : undefined}
            aria-describedby={
              freeDelivery && errors.freeDeliveryFrom
                ? `${fieldIds.freeDeliveryFrom}-error`
                : `${fieldIds.freeDeliveryFrom}-hint`
            }
            {...form.register("freeDeliveryFrom")}
          />
          {freeDelivery && errors.freeDeliveryFrom ? (
            <FieldError
              id={`${fieldIds.freeDeliveryFrom}-error`}
              errors={[errors.freeDeliveryFrom]}
            />
          ) : (
            <FieldDescription id={`${fieldIds.freeDeliveryFrom}-hint`}>
              Orders worth at least this much ship free.
            </FieldDescription>
          )}
        </Field>
        <Button type="submit" className="self-start" disabled={pending || !hydrated}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      </FieldGroup>
    </form>
  );
}
