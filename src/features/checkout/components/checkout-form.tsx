"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type RefObject,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  type Control,
  Controller,
  type FieldError as FormFieldError,
  useForm,
  type UseFormRegisterReturn,
} from "react-hook-form";

import { FormNotice } from "@/components/form-notice";
import { NewTabLink } from "@/components/new-tab-link";
import { Checkbox } from "@/components/ui/checkbox";
import { useStoreFormat } from "@/components/store-format-provider";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { calendarDate, type CalendarDayText, formatCalendarDate } from "@/lib/dates";
import { legalPaths } from "@/lib/legal/paths";
import { formatMoney } from "@/lib/money";
import type { StoreCountry } from "@/lib/shipping/address";

import { startCheckout, type StartCheckoutError } from "../actions/start-checkout";
import {
  type CheckoutPrefill,
  checkoutFields,
  checkoutSchema,
  type CheckoutValues,
} from "../schemas";

// A saved address the signed in customer can swap in (spec 0012, AC-15).
export type SavedAddressChoice = {
  readonly id: string;
  readonly label: string;
  readonly values: Omit<CheckoutPrefill, "email">;
};

export type CheckoutAccount = {
  readonly email: string;
  readonly addresses: readonly SavedAddressChoice[];
};

const mergedMessage =
  "Your cart was updated with items saved in your account. Check it and pay again.";

const noSubscription = () => () => {};

export function minimumMessage(minimum: string): string {
  return `Your total is below the minimum card payment of ${minimum}. Add more to your cart to pay.`;
}

type DiscountRefused = Extract<StartCheckoutError, { readonly code: "discount_refused" }>;

// spec 0006, Result shapes and copy.
function formError(error: StartCheckoutError, money: (cents: number) => string): string | null {
  switch (error.code) {
    case "below_minimum":
      return minimumMessage(money(error.minimumCents));
    case "payment_processing":
      return "A payment for this cart is still processing. We will confirm your order once it completes.";
    case "checkout_in_progress":
      return "Checkout is already starting in another tab. Try again in a moment.";
    case "payment_unavailable":
      return "Payment is unavailable right now. Your cart is saved, please try again in a few minutes.";
    case "validation":
    case "cart_changed":
    case "already_paid":
    case "discount_refused":
    case "terms_changed":
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
  account = null,
  discountCode,
  termsVersion: shownTermsVersion,
  emailRef,
  onDiscountRefused,
}: {
  readonly totalCents: number;
  readonly country: StoreCountry;
  readonly countryName: string;
  readonly prefill: CheckoutPrefill;
  // The signed in customer: the email is theirs, and saved addresses can fill the form.
  readonly account?: CheckoutAccount | null;
  // spec 0014, AC-4: the applied promo code Pay sends, or null.
  readonly discountCode: string | null;
  // spec 0017, AC-9: the terms version this page shows, sent with Pay.
  readonly termsVersion: CalendarDayText;
  // Lets the promo code field read the email as typed, for its per customer check.
  readonly emailRef: RefObject<() => string>;
  // Pay refused the code: the field shows why and the summary drops it.
  readonly onDiscountRefused: (error: DiscountRefused) => void;
}) {
  const router = useRouter();
  const format = useStoreFormat();
  const [pending, startTransition] = useTransition();
  const [redirecting, setRedirecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // spec 0017, AC-10: never an editable field. A terms_changed answer moves it to the new version.
  const [termsVersion, setTermsVersion] = useState(shownTermsVersion);
  const [termsChangedOn, setTermsChangedOn] = useState<CalendarDayText | null>(null);
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
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      ...prefill,
      ...(account === null ? {} : { email: account.email }),
      saveAddress: account !== null,
    },
  });
  const { errors } = form.formState;

  useEffect(() => {
    emailRef.current = () => form.getValues("email");
  }, [emailRef, form]);

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
    setTermsChangedOn(null);
    startTransition(async () => {
      const result = await startCheckout({
        ...values,
        termsVersion,
        ...(discountCode === null ? {} : { discountCode }),
      });
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
      } else if (error.code === "cart_changed" && error.merged) {
        setNotice(mergedMessage);
        router.refresh();
      } else if (error.code === "cart_changed") {
        router.push("/cart");
      } else if (error.code === "discount_refused") {
        onDiscountRefused(error);
      } else if (error.code === "terms_changed") {
        // Every other field keeps its value; the box asks again for the new text.
        form.resetField("acceptTerms");
        setTermsVersion(error.currentVersion);
        setTermsChangedOn(error.currentVersion);
        form.setFocus("acceptTerms");
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
          hint={
            account === null
              ? "For your order number and updates about it."
              : "Your account email. Order updates go here."
          }
          readOnly={account !== null}
          error={errors.email}
          registration={form.register("email")}
        />
        <FieldSet>
          <FieldLegend>Delivery address</FieldLegend>
          <FieldGroup>
            {account !== null && account.addresses.length > 0 ? (
              <SavedAddressPicker
                addresses={account.addresses}
                onPick={(values) => {
                  for (const [name, value] of Object.entries(values)) {
                    form.setValue(name as keyof typeof values, value, { shouldDirty: true });
                  }
                  form.clearErrors();
                }}
              />
            ) : null}
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
        {account !== null ? (
          <Field orientation="horizontal">
            <Controller
              control={form.control}
              name="saveAddress"
              render={({ field }) => (
                <Checkbox
                  id="checkout-save-address"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              )}
            />
            <FieldLabel htmlFor="checkout-save-address" className="font-normal">
              Save this address to my account
            </FieldLabel>
          </Field>
        ) : null}
        <FormNotice
          message={
            termsChangedOn === null ? null : (
              <>
                Our terms of sale changed on{" "}
                {formatCalendarDate(calendarDate(termsChangedOn), format.locale)}. Please read{" "}
                <NewTabLink href={legalPaths.terms}>them</NewTabLink> and tick the box again.
              </>
            )
          }
        />
        <TermsField control={form.control} error={errors.acceptTerms} />
        <Button type="submit" size="lg" className="h-11" disabled={busy || !hydrated}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {redirecting ? "Redirecting to payment…" : `Pay ${formatMoney(totalCents, format)}`}
        </Button>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-4 shrink-0" />
          You enter your card details on Stripe&apos;s secure payment page.
        </p>
        <p className="text-sm text-muted-foreground">
          Before you buy, see how <NewTabLink href={legalPaths.returns}>returns</NewTabLink> and{" "}
          <NewTabLink href={legalPaths.shipping}>shipping</NewTabLink> work.
        </p>
      </FieldGroup>
    </form>
  );
}

// spec 0017, AC-8: unticked to start, never disabling Pay. Pay unticked shows the error under
// the box and focuses it; the server refuses the same (AC-9).
function TermsField({
  control,
  error,
}: {
  readonly control: Control<CheckoutValues>;
  readonly error: FormFieldError | undefined;
}) {
  const id = "checkout-accept-terms";
  const errorId = `${id}-error`;
  return (
    <Field orientation="horizontal" data-invalid={error ? true : undefined}>
      <Controller
        control={control}
        name="acceptTerms"
        render={({ field }) => (
          <Checkbox
            id={id}
            ref={field.ref}
            checked={field.value === true}
            onCheckedChange={(checked) => field.onChange(checked === true ? true : undefined)}
            onBlur={field.onBlur}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        )}
      />
      <FieldContent>
        <FieldLabel htmlFor={id} className="inline leading-normal font-normal">
          I accept the <NewTabLink href={legalPaths.terms}>terms of sale</NewTabLink> and have read
          the <NewTabLink href={legalPaths.privacy}>privacy policy</NewTabLink>.
        </FieldLabel>
        {error ? <FieldError id={errorId} errors={[error]} /> : null}
      </FieldContent>
    </Field>
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
  readonly readOnly?: boolean;
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
        readOnly={input.readOnly}
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

// spec 0012, AC-15: swap in a saved address; the fields stay editable, so a new one can be typed.
function SavedAddressPicker({
  addresses,
  onPick,
}: {
  readonly addresses: readonly SavedAddressChoice[];
  readonly onPick: (values: SavedAddressChoice["values"]) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="checkout-saved-address">Saved addresses</FieldLabel>
      <NativeSelect
        id="checkout-saved-address"
        defaultValue=""
        onChange={(event) => {
          const picked = addresses.find((address) => address.id === event.target.value);
          if (picked) onPick(picked.values);
        }}
        className="w-full"
      >
        <NativeSelectOption value="">Choose a saved address</NativeSelectOption>
        {addresses.map((address) => (
          <NativeSelectOption key={address.id} value={address.id}>
            {address.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldDescription>Picking one fills in the fields below.</FieldDescription>
    </Field>
  );
}
