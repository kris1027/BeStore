"use client";

import { type RefObject, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";

import type { AppliedDiscount } from "../actions/apply-discount";

const inputId = "checkout-discount-code";
const errorId = `${inputId}-error`;

// spec 0014, AC-1: the promo code field. Its own form, outside the payment form, so Enter in it
// runs Apply and never Pay. The parent owns the state, because Pay's answer can refuse the code
// too (AC-4). Refusals show under the field and are announced politely; focus stays here.
export function DiscountField({
  text,
  onTextChange,
  applied,
  error,
  announcement,
  inputRef,
  onApply,
  onRemove,
}: {
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  readonly applied: AppliedDiscount | null;
  readonly error: string | null;
  readonly announcement: string;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onApply: () => Promise<void>;
  readonly onRemove: () => void;
}) {
  const hydrated = useHydrated();
  const [pending, startTransition] = useTransition();

  return (
    <form
      noValidate
      aria-label="Apply a promo code"
      onSubmit={(event) => {
        event.preventDefault();
        if (applied !== null || pending) return;
        startTransition(onApply);
      }}
    >
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={inputId}>Promo code</FieldLabel>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            id={inputId}
            name="discountCode"
            value={applied?.code ?? text}
            onChange={(event) => onTextChange(event.target.value)}
            readOnly={applied !== null}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="uppercase"
          />
          {applied === null ? (
            <Button type="submit" variant="outline" disabled={pending || !hydrated}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Apply
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
        {error ? (
          <p id={errorId} className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Field>
      {/* Mounted from the start, so a message set after Apply is announced. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </form>
  );
}
