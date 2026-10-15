"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";
import type { z } from "zod";

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { shippingAddressSchema } from "@/lib/shipping/address";

// What the address fields hold: the schema's input (spec 0007), so the form validates with it.
export type AddressFormValues = z.input<ReturnType<typeof shippingAddressSchema>>;

export const emptyAddressValues = {
  fullName: "",
  line1: "",
  line2: "",
  postalCode: "",
  city: "",
  phone: "",
} satisfies AddressFormValues;

type FieldSpec = {
  readonly name: keyof AddressFormValues;
  readonly label: string;
  readonly autoComplete: string;
  readonly hint?: string;
  readonly type?: "tel";
  readonly inputMode?: "numeric" | "tel";
};

const fields: readonly FieldSpec[] = [
  { name: "fullName", label: "Full name", autoComplete: "shipping name" },
  {
    name: "line1",
    label: "Address line 1",
    autoComplete: "shipping address-line1",
    hint: "Street and building number.",
  },
  {
    name: "line2",
    label: "Address line 2 (optional)",
    autoComplete: "shipping address-line2",
    hint: "Apartment, floor or company.",
  },
  {
    name: "postalCode",
    label: "Postal code",
    autoComplete: "shipping postal-code",
    inputMode: "numeric",
  },
  { name: "city", label: "City", autoComplete: "shipping address-level2" },
  {
    name: "phone",
    label: "Phone (optional)",
    autoComplete: "tel",
    type: "tel",
    inputMode: "tel",
    hint: "Only if the courier needs to reach you.",
  },
];

// The delivery address fields (spec 0007's rules), with the store's one country shown, never
// typed. `idPrefix` keeps ids unique when several forms share a page.
export function AddressFormFields({
  idPrefix,
  register,
  errors,
  countryName,
}: {
  readonly idPrefix: string;
  readonly register: UseFormRegister<AddressFormValues>;
  readonly errors: FieldErrors<AddressFormValues>;
  readonly countryName: string;
}) {
  return (
    <FieldGroup>
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const error = errors[field.name];
        const describedBy = error ? `${id}-error` : field.hint ? `${id}-hint` : undefined;
        return (
          <Field key={field.name} data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
            <Input
              id={id}
              type={field.type ?? "text"}
              inputMode={field.inputMode}
              autoComplete={field.autoComplete}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              {...register(field.name)}
            />
            {error ? (
              <FieldError id={`${id}-error`} errors={[error]} />
            ) : field.hint ? (
              <FieldDescription id={`${id}-hint`}>{field.hint}</FieldDescription>
            ) : null}
          </Field>
        );
      })}
      <dl className="flex flex-col gap-1 text-sm">
        <dt className="font-medium">Country</dt>
        <dd className="text-muted-foreground">{countryName}</dd>
      </dl>
    </FieldGroup>
  );
}
