"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";
import { applyFieldErrors } from "@/lib/form-errors";

import { updateProfile } from "../actions/settings";
import { accountMessages } from "../messages";
import { profileSchema } from "../schemas";

// spec 0012, AC-18: name and phone, both optional.
export function ProfileForm({
  name,
  phone,
}: {
  readonly name: string | null;
  readonly phone: string | null;
}) {
  const hydrated = useHydrated();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: name ?? "", phone: phone ?? "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setSaved(false);
    startTransition(async () => {
      const result = await updateProfile(values);
      if (result.ok) setSaved(true);
      else applyFieldErrors(form.setError, result.error.fields);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Your details">
      <FieldGroup>
        <FormNotice message={saved ? accountMessages.profileSaved : null} tone="info" />
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="profile-name">Name (optional)</FieldLabel>
          <Input
            id="profile-name"
            autoComplete="name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "profile-name-error" : undefined}
            {...form.register("name")}
          />
          <FieldError id="profile-name-error" errors={[errors.name]} />
        </Field>
        <Field data-invalid={errors.phone ? true : undefined}>
          <FieldLabel htmlFor="profile-phone">Phone (optional)</FieldLabel>
          <Input
            id="profile-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? "profile-phone-error" : "profile-phone-hint"}
            {...form.register("phone")}
          />
          {errors.phone ? (
            <FieldError id="profile-phone-error" errors={[errors.phone]} />
          ) : (
            <FieldDescription id="profile-phone-hint">
              Only for questions about your orders.
            </FieldDescription>
          )}
        </Field>
        <Button type="submit" size="lg" className="self-start" disabled={pending || !hydrated}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save details
        </Button>
      </FieldGroup>
    </form>
  );
}
