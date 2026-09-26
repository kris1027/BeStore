"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import { signIn } from "../actions/sign-in";
import { authMessages, type SignInReason } from "../messages";
import { signInSchema } from "../schemas";
import { FormNotice } from "./form-notice";
import { applyFieldErrors } from "./form-errors";

type SignInFormProps = {
  readonly next: string | null;
  // Why the visitor is here (signed out, expired, ...), from the page's `reason` param.
  readonly reason: SignInReason | null;
};

export function SignInForm({ next, reason }: SignInFormProps) {
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
      const result = await signIn(values, next);
      if (result.ok) return;
      applyFieldErrors(form.setError, result.error.fields);
      if (result.error.form) {
        setFormError(authMessages[result.error.form]);
        // A failed sign in clears the password, as a fresh attempt needs it typed again.
        form.resetField("password");
        form.setFocus("password");
      }
    });
  });

  const notice = formError ?? (reason ? authMessages[reason] : null);
  const noticeTone = formError || (reason && reason !== "signed_out") ? "error" : "info";

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <FormNotice id="sign-in-notice" message={notice} tone={noticeTone} />
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
        <Field data-invalid={errors.password ? true : undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Link
              href="/admin/forgot-password"
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
          <FieldError id="password-error" errors={[errors.password]} />
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Sign in
        </Button>
      </FieldGroup>
    </form>
  );
}
