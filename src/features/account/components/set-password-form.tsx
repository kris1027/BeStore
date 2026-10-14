"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { applyFieldErrors } from "@/lib/form-errors";

import { type SetPasswordError, setPassword } from "../actions/set-password";
import { accountMessages } from "../messages";
import { passwordUpdateMessages } from "../password-errors";
import { accountPaths } from "../paths";
import { newPasswordSchema } from "../schemas";
import { NewPasswordFields } from "./new-password-fields";

function formMessage(error: NonNullable<SetPasswordError["form"]>): string {
  switch (error) {
    case "session_missing":
      return accountMessages.sessionMissing;
    case "runs_the_store":
      return accountMessages.runsTheStorePassword;
    case "setup_failed":
      return accountMessages.unavailable;
    default:
      return passwordUpdateMessages[error];
  }
}

// spec 0012, AC-3: the password is chosen here, after the confirm or reset link.
export function SetPasswordForm({ from }: { readonly from: "signup" | "reset" }) {
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionMissing, setSessionMissing] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await setPassword(values, from);
      if (result.ok) return;
      applyFieldErrors(form.setError, result.error.fields);
      if (result.error.form) {
        setFormError(formMessage(result.error.form));
        setSessionMissing(result.error.form === "session_missing");
        form.setFocus("password");
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Choose your password">
      <FieldGroup>
        <FormNotice message={formError} />
        {sessionMissing ? (
          <Link href={accountPaths.signIn} className="text-sm underline underline-offset-4">
            Sign in
          </Link>
        ) : null}
        <NewPasswordFields control={form.control} register={form.register} errors={errors} />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save password
        </Button>
      </FieldGroup>
    </form>
  );
}
