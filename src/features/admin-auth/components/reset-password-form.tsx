"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { resetPassword } from "../actions/password-reset";
import { authMessages, passwordRuleMessages } from "../messages";
import { missingPasswordRules, resetPasswordSchema } from "../schemas";
import { applyFieldErrors } from "./form-errors";
import { FormNotice } from "./form-notice";

const ruleList = Object.values(passwordRuleMessages).join(", ").toLowerCase();

export function ResetPasswordForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const { errors } = form.formState;
  const password = useWatch({ control: form.control, name: "password" });
  // Name every missing part, not only the first one Zod reports (AC-10).
  const missing = errors.password ? missingPasswordRules(password) : [];

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await resetPassword(values);
      if (result.ok) return;
      applyFieldErrors(form.setError, result.error.fields);
      if (result.error.form) {
        setFormError(authMessages[result.error.form]);
        form.setFocus("password");
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormNotice message={formError} />
        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "password-help password-error" : "password-help"}
            {...form.register("password")}
          />
          <FieldDescription id="password-help">It needs {ruleList}.</FieldDescription>
          <FieldError
            id="password-error"
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
          <FieldLabel htmlFor="confirm">Type it again</FieldLabel>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.confirm ? true : undefined}
            aria-describedby={errors.confirm ? "confirm-error" : undefined}
            {...form.register("confirm")}
          />
          <FieldError id="confirm-error" errors={[errors.confirm]} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save new password
        </Button>
      </FieldGroup>
    </form>
  );
}
