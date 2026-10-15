"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { applyFieldErrors } from "@/lib/form-errors";

import { type SignInError, signInCustomer } from "../actions/sign-in";
import { accountMessages } from "../messages";
import { accountPaths } from "../paths";
import { signInSchema } from "../schemas";
import { EmailField } from "./email-field";

const formMessages: Record<NonNullable<SignInError["form"]>, string> = {
  invalid_credentials: accountMessages.invalidCredentials,
  rate_limited: accountMessages.rateLimited,
  unavailable: accountMessages.unavailable,
};

// spec 0012, AC-4.
export function SignInForm({ next }: { readonly next: string | null }) {
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await signInCustomer(values, next);
      if (result.ok) return;
      applyFieldErrors(form.setError, result.error.fields);
      if (result.error.form) {
        setFormError(formMessages[result.error.form]);
        // A failed sign in clears the password, as a fresh attempt needs it typed again.
        form.resetField("password");
        form.setFocus("password");
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Sign in">
      <FieldGroup>
        <FormNotice message={formError} />
        <EmailField id="sign-in-email" error={errors.email} registration={form.register("email")} />
        <Field data-invalid={errors.password ? true : undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
            <Link
              href={accountPaths.forgotPassword}
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "sign-in-password-error" : undefined}
            {...form.register("password")}
          />
          <FieldError id="sign-in-password-error" errors={[errors.password]} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Sign in
        </Button>
      </FieldGroup>
    </form>
  );
}
