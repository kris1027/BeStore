"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import {
  type FieldError as FormFieldError,
  useForm,
  type UseFormRegisterReturn,
} from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { useStoreFormat } from "@/components/store-format-provider";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney } from "@/lib/money";
import type { StoreCountry } from "@/lib/shipping/address";

import { startCheckout, type StartCheckoutError } from "../actions/start-checkout";
import { type CheckoutPrefill, checkoutFields, checkoutSchema } from "../schemas";

const noSubscription = () => () => {};

// spec 0006, Result shapes and copy.
function formError(error: StartCheckoutError, money: (cents: number) => string): string | null {
  switch (error.code) {
    case "below_minimum":
      return `Your total is below the minimum card payment of ${money(error.minimumCents)}. Add more to your cart to pay.`;
    case "payment_processing":
      return "A payment for this cart is still processing. We will confirm your order once it completes.";
    case "checkout_in_progress":
      return "Checkout is already starting in another tab. Try again in a moment.";
    case "payment_unavailable":
      return "Payment is unavailable right now. Your cart is saved, please try again in a few minutes.";
    case "validation":
    case "cart_changed":
    case "already_paid":
      return null;
  }
}

// spec 0006, AC-1, AC-2 and AC-9: the email, the delivery address (spec 0007, AC-1 and AC-2) and
// the Pay button. Card details are only ever typed on Stripe's page.
export function CheckoutForm({
  totalCents,
  country,
  countryName,
  prefill,
}: {
  readonly totalCents: number;
  readonly country: StoreCountry;
  readonly countryName: string;
  readonly prefill: CheckoutPrefill;
}) {
  const router = useRouter();
  const format = useStoreFormat();
  const [pending, startTransition] = useTransition();
  const [redirecting, setRedirecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Until React takes over, the button stays disabled: a native submit would put the email in
  // the URL as a GET query. A disabled default button also blocks submitting with Enter.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const schema = useMemo(() => checkoutSchema(country), [country]);
  // The resolver hands the cleaned output to the submit handler; the server parses it again,
  // which every transform in the schema allows.
  const form = useForm({ resolver: zodResolver(schema), defaultValues: prefill });
  const { errors } = form.formState;

  // Back from Stripe can restore this page from the back/forward cache with the button still
  // saying it is redirecting; a restored page starts over.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const onSubmit = form.handleSubmit((values) => {
    setNotice(null);
    startTransition(async () => {
      const result = await startCheckout(values);
      if (result.ok) {
        setRedirecting(true);
        window.location.assign(result.data.url);
        return;
      }
      const { error } = result;
      if (error.code === "validation") {
        // The server names the same fields and messages as the form; focus the first one.
        const invalid = checkoutFields.filter((field) => error.fields[field] !== undefined);
        invalid.forEach((field, index) => {
          form.setError(
            field,
            { type: "server", message: error.fields[field] },
            { shouldFocus: index === 0 },
          );
        });
      } else if (error.code === "cart_changed") {
        router.push("/cart");
      } else if (error.code === "already_paid") {
        setRedirecting(true);
        window.location.assign(error.confirmationUrl);
      } else {
        setNotice(formError(error, (cents) => formatMoney(cents, format)));
      }
    });
  });

  const busy = pending || redirecting;

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Payment">
      <FieldGroup>
        <FormNotice message={notice} />
        <TextField
          id="checkout-email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          hint="For your order number and updates about it."
          error={errors.email}
          registration={form.register("email")}
        />
        <FieldSet>
          <FieldLegend>Delivery address</FieldLegend>
          <FieldGroup>
            <TextField
              id="checkout-full-name"
              label="Full name"
              autoComplete="shipping name"
              error={errors.fullName}
              registration={form.register("fullName")}
            />
            <TextField
              id="checkout-line1"
              label="Address line 1"
              autoComplete="shipping address-line1"
              hint="Street and building number."
              error={errors.line1}
              registration={form.register("line1")}
            />
            <TextField
              id="checkout-line2"
              label="Address line 2 (optional)"
              autoComplete="shipping address-line2"
              hint="Apartment, floor or company."
              error={errors.line2}
              registration={form.register("line2")}
            />
            <div className="grid gap-x-4 gap-y-7 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <TextField
                id="checkout-postal-code"
                label="Postal code"
                autoComplete="shipping postal-code"
                inputMode="numeric"
                error={errors.postalCode}
                registration={form.register("postalCode")}
              />
              <TextField
                id="checkout-city"
                label="City"
                autoComplete="shipping address-level2"
                error={errors.city}
                registration={form.register("city")}
              />
            </div>
            {/* The one country the store ships to: shown, never typed (AC-1). */}
            <dl className="flex flex-col gap-1 text-sm">
              <dt className="font-medium">Country</dt>
              <dd className="text-muted-foreground">{countryName}</dd>
            </dl>
            <TextField
              id="checkout-phone"
              label="Phone (optional)"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              hint="Only if the courier needs to reach you."
              error={errors.phone}
              registration={form.register("phone")}
            />
          </FieldGroup>
        </FieldSet>
        <Button type="submit" size="lg" className="h-11" disabled={busy || !hydrated}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {redirecting ? "Redirecting to payment…" : `Pay ${formatMoney(totalCents, format)}`}
        </Button>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-4 shrink-0" />
          You enter your card details on Stripe&apos;s secure payment page.
        </p>
      </FieldGroup>
    </form>
  );
}

function TextField({
  id,
  label,
  hint,
  error,
  registration,
  ...input
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error: FormFieldError | undefined;
  readonly registration: UseFormRegisterReturn;
  readonly type?: "email" | "tel" | "text";
  readonly inputMode?: "email" | "numeric" | "tel";
  readonly autoComplete: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={input.type ?? "text"}
        inputMode={input.inputMode}
        autoComplete={input.autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...registration}
      />
      {error ? (
        <FieldError id={errorId} errors={[error]} />
      ) : hint ? (
        <FieldDescription id={hintId}>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}
