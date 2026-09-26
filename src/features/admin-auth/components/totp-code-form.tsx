"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { verifyTotp } from "../actions/mfa";
import { authMessages } from "../messages";
import { totpCodeSchema } from "../schemas";
import { applyFieldErrors } from "./form-errors";
import { FormNotice } from "./form-notice";

type TotpCodeFormProps = {
  readonly next: string | null;
  readonly submitLabel: string;
};

// Used by both the verify view and the enroll view: the server finds the factor itself.
export function TotpCodeForm({ next, submitLabel }: TotpCodeFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm({ resolver: zodResolver(totpCodeSchema), defaultValues: { code: "" } });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await verifyTotp(values, next);
      if (result.ok) return;
      applyFieldErrors(form.setError, result.error.fields);
      if (result.error.form) {
        setFormError(authMessages[result.error.form]);
        form.resetField("code");
        form.setFocus("code");
      }
    });
  });

  const describedBy = ["code-help", errors.code ? "code-error" : null].filter(Boolean).join(" ");

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormNotice message={formError} />
        <Field data-invalid={errors.code ? true : undefined}>
          <FieldLabel htmlFor="code">6 digit code</FieldLabel>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            className="font-mono tracking-widest"
            aria-invalid={errors.code ? true : undefined}
            aria-describedby={describedBy}
            {...form.register("code")}
          />
          <FieldDescription id="code-help">
            The code changes every 30 seconds. Type the one your app shows now.
          </FieldDescription>
          <FieldError id="code-error" errors={[errors.code]} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {submitLabel}
        </Button>
      </FieldGroup>
    </form>
  );
}
