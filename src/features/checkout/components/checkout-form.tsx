"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useForm } from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { useStoreFormat } from "@/components/store-format-provider";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney } from "@/lib/money";

import { startCheckout, type StartCheckoutError } from "../actions/start-checkout";
import { checkoutMessages, checkoutSchema } from "../schemas";

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

// spec 0006, AC-1, AC-2 and AC-9: the email and the Pay button. Card details are only ever
// typed on Stripe's page.
export function CheckoutForm({ totalCents }: { readonly totalCents: number }) {
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
  const form = useForm({ resolver: zodResolver(checkoutSchema), defaultValues: { email: "" } });
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
        form.setError(
          "email",
          { type: "server", message: checkoutMessages.emailInvalid },
          { shouldFocus: true },
        );
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
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="checkout-email">Email</FieldLabel>
          <Input
            id="checkout-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "checkout-email-error" : "checkout-email-hint"}
            {...form.register("email")}
          />
          {errors.email ? (
            <FieldError id="checkout-email-error" errors={[errors.email]} />
          ) : (
            <FieldDescription id="checkout-email-hint">
              For your order number and updates about it.
            </FieldDescription>
          )}
        </Field>
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
