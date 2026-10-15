"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { applyFieldErrors } from "@/lib/form-errors";

import { resendConfirmation } from "../actions/sign-up";
import { accountMessages } from "../messages";
import { emailFormSchema } from "../schemas";
import { EmailField } from "./email-field";

// spec 0012, AC-1 and AC-2: "Send the link again". After sign up the email is known and stays
// hidden; on an expired link page the visitor types it.
export function ResendLinkForm({ email }: { readonly email?: string }) {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { email: email ?? "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setSent(false);
    startTransition(async () => {
      const result = await resendConfirmation(values);
      if (result.ok) setSent(true);
      else applyFieldErrors(form.setError, result.error.fields);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Send the link again">
      <FieldGroup>
        <FormNotice message={sent ? accountMessages.linkResent : null} tone="info" />
        {email === undefined ? (
          <EmailField
            id="resend-email"
            error={errors.email}
            registration={form.register("email")}
          />
        ) : null}
        <Button type="submit" variant="outline" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Send the link again
        </Button>
      </FieldGroup>
    </form>
  );
}
