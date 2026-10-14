"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";
import { applyFieldErrors } from "@/lib/form-errors";

import { changePassword, type ChangePasswordError } from "../actions/settings";
import { accountMessages } from "../messages";
import { passwordUpdateMessages } from "../password-errors";
import { changePasswordSchema } from "../schemas";
import { NewPasswordFields } from "./new-password-fields";

function formMessage(error: NonNullable<ChangePasswordError["form"]>): string {
  switch (error) {
    case "wrong_password":
      return accountMessages.wrongCurrentPassword;
    case "runs_the_store":
      return accountMessages.runsTheStorePassword;
    default:
      return passwordUpdateMessages[error];
  }
}

const emptyValues = { currentPassword: "", password: "", confirm: "" };

// spec 0012, AC-19.
export function ChangePasswordForm() {
  const hydrated = useHydrated();
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm({ resolver: zodResolver(changePasswordSchema), defaultValues: emptyValues });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setNotice(null);
    startTransition(async () => {
      const result = await changePassword(values);
      if (result.ok) {
        form.reset(emptyValues);
        setNotice({ text: accountMessages.passwordChanged, tone: "info" });
        return;
      }
      applyFieldErrors(form.setError, result.error.fields);
      if (result.error.form) {
        setNotice({ text: formMessage(result.error.form), tone: "error" });
        form.setFocus(result.error.form === "wrong_password" ? "currentPassword" : "password");
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Change password">
      <FieldGroup>
        <FormNotice message={notice?.text ?? null} tone={notice?.tone ?? "error"} />
        <Field data-invalid={errors.currentPassword ? true : undefined}>
          <FieldLabel htmlFor="current-password">Current password</FieldLabel>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.currentPassword ? true : undefined}
            aria-describedby={errors.currentPassword ? "current-password-error" : undefined}
            {...form.register("currentPassword")}
          />
          <FieldError id="current-password-error" errors={[errors.currentPassword]} />
        </Field>
        <NewPasswordFields control={form.control} register={form.register} errors={errors} />
        <Button type="submit" size="lg" className="self-start" disabled={pending || !hydrated}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Change password
        </Button>
      </FieldGroup>
    </form>
  );
}
