"use client";

import { type Control, type FieldErrors, useWatch, type UseFormRegister } from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { missingPasswordRules, passwordRuleList, passwordRuleMessages } from "@/lib/auth/password";

import type { NewPasswordValues } from "../schemas";

// The new password and its repeat (AC-3). A refusal names every missing part, not only the first
// one Zod reports.
export function NewPasswordFields({
  control,
  register,
  errors,
  label = "New password",
}: {
  readonly control: Control<NewPasswordValues>;
  readonly register: UseFormRegister<NewPasswordValues>;
  readonly errors: FieldErrors<NewPasswordValues>;
  readonly label?: string;
}) {
  const password = useWatch({ control, name: "password" });
  const missing = errors.password ? missingPasswordRules(password) : [];
  return (
    <>
      <Field data-invalid={errors.password ? true : undefined}>
        <FieldLabel htmlFor="new-password">{label}</FieldLabel>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={
            errors.password ? "new-password-help new-password-error" : "new-password-help"
          }
          {...register("password")}
        />
        <FieldDescription id="new-password-help">It needs {passwordRuleList}.</FieldDescription>
        <FieldError
          id="new-password-error"
          errors={
            missing.length > 0
              ? missing.map((rule) => ({
                  message: `Missing: ${passwordRuleMessages[rule].toLowerCase()}`,
                }))
              : [errors.password]
          }
        />
      </Field>
      <Field data-invalid={errors.confirm ? true : undefined}>
        <FieldLabel htmlFor="new-password-confirm">Type it again</FieldLabel>
        <Input
          id="new-password-confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.confirm ? true : undefined}
          aria-describedby={errors.confirm ? "new-password-confirm-error" : undefined}
          {...register("confirm")}
        />
        <FieldError id="new-password-confirm-error" errors={[errors.confirm]} />
      </Field>
    </>
  );
}
