import type { FieldError as FormFieldError, UseFormRegisterReturn } from "react-hook-form";

import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

// The labelled email input every account form shares, with its error tied to it.
export function EmailField({
  id,
  error,
  registration,
}: {
  readonly id: string;
  readonly error: FormFieldError | undefined;
  readonly registration: UseFormRegisterReturn;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>Email</FieldLabel>
      <Input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="email"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...registration}
      />
      <FieldError id={`${id}-error`} errors={[error]} />
    </Field>
  );
}
