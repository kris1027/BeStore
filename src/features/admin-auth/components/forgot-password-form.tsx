"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { requestPasswordReset } from "../actions/password-reset";
import { authMessages } from "../messages";
import { forgotPasswordSchema } from "../schemas";
import { applyFieldErrors } from "./form-errors";
import { FormNotice } from "./form-notice";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setSent(false);
    startTransition(async () => {
      const result = await requestPasswordReset(values);
      if (result.ok) setSent(true);
      else applyFieldErrors(form.setError, result.error.fields);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {/* The same reply whether or not the email belongs to an admin (AC-9). */}
        <FormNotice message={sent ? authMessages.reset_sent : null} tone="info" />
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...form.register("email")}
          />
          <FieldError id="email-error" errors={[errors.email]} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Send reset link
        </Button>
      </FieldGroup>
    </form>
  );
}
