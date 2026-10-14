"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";
import { applyFieldErrors } from "@/lib/form-errors";

import { deleteAccount, type DeleteAccountError } from "../actions/settings";
import { accountMessages } from "../messages";
import { deleteAccountSchema } from "../schemas";

const formMessages: Record<NonNullable<DeleteAccountError["form"]>, string> = {
  wrong_password: accountMessages.wrongCurrentPassword,
  runs_the_store: accountMessages.runsTheStoreDelete,
  delete_failed: accountMessages.deleteFailed,
  rate_limited: accountMessages.rateLimited,
  unavailable: accountMessages.unavailable,
};

// spec 0012, AC-20: delete asks for the password and says first what happens to open orders.
export function DeleteAccountDialog({
  openOrders,
  email,
}: {
  // Orders paid but not shipped yet.
  readonly openOrders: number;
  readonly email: string;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { password: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteAccount(values);
      if (result.ok) return;
      applyFieldErrors(form.setError, result.error.fields);
      if (result.error.form) {
        setMessage(formMessages[result.error.form]);
        form.resetField("password");
        form.setFocus("password");
      }
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMessage(null);
          form.reset({ password: "" });
        }
      }}
    >
      <DialogTrigger render={<Button type="button" variant="destructive" disabled={!hydrated} />}>
        Delete my account
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your profile, saved addresses, cart and sign in are deleted for good. Orders you paid
              for stay with the store for its records.
            </DialogDescription>
          </DialogHeader>
          {openOrders > 0 ? (
            <p className="rounded-md border bg-muted/40 p-3 text-sm">
              You have {openOrders} {openOrders === 1 ? "order" : "orders"} not shipped yet. They
              will still be delivered, and emails about them still go to {email}.
            </p>
          ) : null}
          <FormNotice message={message} />
          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor="delete-password">Your password</FieldLabel>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? "delete-password-error" : undefined}
              {...form.register("password")}
            />
            <FieldError id="delete-password-error" errors={[errors.password]} />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Delete my account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
