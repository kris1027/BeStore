"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { applyFieldErrors } from "@/lib/form-errors";

import { signUp } from "../actions/sign-up";
import { accountMessages } from "../messages";
import { emailFormSchema } from "../schemas";
import { EmailField } from "./email-field";
import { ResendLinkForm } from "./resend-link-form";

// spec 0012, AC-1: an email only. The reply is always "Check your email"; the password comes
// after the confirm link (AC-3).
export function SignUpForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm({ resolver: zodResolver(emailFormSchema), defaultValues: { email: "" } });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await signUp(values);
      if (result.ok) setSentTo(values.email);
      else applyFieldErrors(form.setError, result.error.fields);
    });
  });

  if (sentTo !== null) return <CheckEmail email={sentTo} />;

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Create an account">
      <FieldGroup>
        <EmailField id="sign-up-email" error={errors.email} registration={form.register("email")} />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Continue
        </Button>
      </FieldGroup>
    </form>
  );
}

// Takes focus when it appears, so a screen reader hears that the form was sent.
export function CheckEmail({ email }: { readonly email?: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-labelledby="check-email-heading" className="flex flex-col gap-4">
      <h2
        id="check-email-heading"
        ref={heading}
        tabIndex={-1}
        className="font-heading text-2xl outline-none"
      >
        {accountMessages.checkEmailTitle}
      </h2>
      <p className="text-muted-foreground">{accountMessages.checkEmailBody}</p>
      <ResendLinkForm email={email} />
    </section>
  );
}
