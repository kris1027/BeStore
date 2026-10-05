"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useHydrated } from "@/hooks/use-hydrated";
import type { ActionResult } from "@/lib/result";

import { errorMessage, type OrderActionError } from "../messages";

// The pieces every order action form shares (spec 0010, AC-24): a dialog that moves focus in
// and back to its trigger, a form level notice, and fields whose errors are linked to them.

// What every action posts back besides its own fields (AC-8).
export type OrderRef = { readonly orderNumber: number; readonly expectedUpdatedAt: string };

export type FieldErrors = Readonly<Record<string, string>>;

// Runs one action: on success a toast and a refresh (the page re-reads the order and its
// updated_at); on failure the fields or the form notice. Errors that leave the order in a new
// state (a refund now failed or pending) refresh too, so the page shows it.
export function useOrderAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function run<T>(
    call: () => Promise<ActionResult<T, OrderActionError>>,
    handlers: {
      readonly success: string;
      readonly onSuccess?: (data: T) => void;
      // Returns true when it showed the field errors itself.
      readonly onFields?: (fields: Readonly<Record<string, readonly string[]>>) => boolean;
    },
  ) {
    setNotice(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) {
        toast.add({ title: handlers.success, type: "success" });
        handlers.onSuccess?.(result.data);
        router.refresh();
        return;
      }
      const { error } = result;
      if (error.code === "invalid_input" && handlers.onFields?.(error.fields)) return;
      setNotice(errorMessage(error));
      if (error.code === "stripe_refused" || error.code === "stripe_unavailable") router.refresh();
    });
  }

  return { pending, notice, setNotice, run };
}

// The first message per field path from a server answer.
export function firstErrors(fields: Readonly<Record<string, readonly string[]>>): FieldErrors {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([path, messages]) =>
      messages[0] === undefined ? [] : [[path, messages[0]]],
    ),
  );
}

export function focusFirst(ids: readonly string[]) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) {
      element.focus();
      return;
    }
  }
}

export function ActionDialog({
  label,
  title,
  description,
  submitLabel,
  variant = "outline",
  submitVariant = "default",
  open,
  onOpenChange,
  pending,
  notice,
  onSubmit,
  onBack,
  children,
}: {
  readonly label: React.ReactNode;
  readonly title: string;
  readonly description?: React.ReactNode;
  readonly submitLabel: string;
  readonly variant?: "default" | "outline" | "destructive" | "secondary";
  readonly submitVariant?: "default" | "destructive";
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly notice: string | null;
  readonly onSubmit: () => void;
  // A two step form's way back from its confirm step.
  readonly onBack?: () => void;
  readonly children?: React.ReactNode;
}) {
  const hydrated = useHydrated();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button type="button" variant={variant} disabled={!hydrated} />}>
        {label}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="flex flex-col gap-5"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <FormNotice message={notice} />
          {children}
          <DialogFooter>
            {onBack ? (
              <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
                Back
              </Button>
            ) : (
              <DialogClose render={<Button type="button" variant="outline" />}>Close</DialogClose>
            )}
            <Button type="submit" variant={submitVariant} disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  description,
  multiline = false,
  maxLength,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly description?: string;
  readonly multiline?: boolean;
  readonly maxLength?: number;
}) {
  const describedBy =
    [description ? `${id}-description` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  const common = {
    id,
    value,
    autoComplete: "off",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    // A little over the limit, so the field can show its own error instead of cutting text.
    maxLength: maxLength === undefined ? undefined : maxLength + 50,
  } as const;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea {...common} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input {...common} onChange={(event) => onChange(event.target.value)} />
      )}
      {description ? (
        <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
      ) : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}
