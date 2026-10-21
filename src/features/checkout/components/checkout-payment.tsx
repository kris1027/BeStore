"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";

import type { CalendarDayText } from "@/lib/dates";
import { DeliveryRow } from "@/components/delivery-row";
import { Price } from "@/components/price";
import { useStoreFormat } from "@/components/store-format-provider";
import { Separator } from "@/components/ui/separator";
import { discountRowLabel, refusalMessage } from "@/lib/discounts/rule";
import { formatMoney } from "@/lib/money";
import type { StoreCountry } from "@/lib/shipping/address";

import {
  type AppliedDiscount,
  type ApplyDiscountError,
  applyDiscountCode,
} from "../actions/apply-discount";
import type { CheckoutPrefill } from "../schemas";
import { type CheckoutAccount, CheckoutForm, minimumMessage } from "./checkout-form";
import { DiscountField } from "./discount-field";

// What the page renders with (spec 0014, AC-9): a code coming back from an earlier Pay, either
// still applied or in the field with its refusal.
export type InitialDiscount =
  | { readonly kind: "applied"; readonly applied: AppliedDiscount }
  | { readonly kind: "refused"; readonly text: string; readonly message: string }
  | null;

// spec 0014, AC-1: the summary rows, the promo code field and the payment form. The rows start
// from the server's totals and follow Apply's answer; Pay checks the code again on its own.
export function CheckoutPayment({
  subtotalCents,
  shippingCents,
  totalCents,
  initialDiscount,
  signInHint,
  ...form
}: {
  readonly subtotalCents: number;
  // Without a code.
  readonly shippingCents: number;
  readonly totalCents: number;
  readonly initialDiscount: InitialDiscount;
  readonly signInHint: ReactNode;
  readonly country: StoreCountry;
  readonly countryName: string;
  readonly prefill: CheckoutPrefill;
  readonly account: CheckoutAccount | null;
  // spec 0017, AC-9: the terms version the page shows.
  readonly termsVersion: CalendarDayText;
}) {
  const router = useRouter();
  const format = useStoreFormat();
  const money = (cents: number) => formatMoney(cents, format);
  const inputRef = useRef<HTMLInputElement>(null);
  // The payment form's email, read when Apply runs (check 5 needs a known email).
  const emailRef = useRef<() => string>(() => "");
  const [applied, setApplied] = useState<AppliedDiscount | null>(
    initialDiscount?.kind === "applied" ? initialDiscount.applied : null,
  );
  // An applied code starts in the text too, so a later Pay refusal (AC-4) leaves it in the field.
  const [text, setText] = useState(
    initialDiscount?.kind === "applied"
      ? initialDiscount.applied.code
      : initialDiscount?.kind === "refused"
        ? initialDiscount.text
        : "",
  );
  const [error, setError] = useState<string | null>(
    initialDiscount?.kind === "refused" ? initialDiscount.message : null,
  );
  const [announcement, setAnnouncement] = useState("");

  function refuse(error: ApplyDiscountError) {
    setApplied(null);
    if (error.code === "cart_changed") {
      if (error.merged) router.refresh();
      else router.push("/cart");
      return;
    }
    const message =
      error.code === "below_minimum"
        ? minimumMessage(money(error.minimumCents))
        : refusalMessage(error, format);
    setError(message);
    setAnnouncement(message);
    inputRef.current?.focus();
  }

  async function apply() {
    setError(null);
    const result = await applyDiscountCode({ code: text, email: emailRef.current() });
    if (!result.ok) return refuse(result.error);
    setApplied(result.data);
    setText(result.data.code);
    setAnnouncement(
      `Code ${result.data.code} applied. Your total is now ${money(result.data.totalCents)}.`,
    );
  }

  function remove() {
    setApplied(null);
    setText("");
    setError(null);
    setAnnouncement(`Code removed. Your total is ${money(totalCents)}.`);
    inputRef.current?.focus();
  }

  const shown = applied ?? { discountCents: 0, shippingCents, totalCents };

  return (
    <>
      <DiscountField
        text={text}
        onTextChange={(value) => {
          setText(value);
          setError(null);
        }}
        applied={applied}
        error={error}
        announcement={announcement}
        inputRef={inputRef}
        onApply={apply}
        onRemove={remove}
      />
      <div className="flex items-center justify-between">
        <span>Subtotal</span>
        <span className="font-medium">
          <Price cents={subtotalCents} />
        </span>
      </div>
      {applied !== null ? (
        <div className="flex items-center justify-between">
          <span>{discountRowLabel(applied.code)}</span>
          <span className="font-medium">
            −<Price cents={applied.discountCents} />
          </span>
        </div>
      ) : null}
      <DeliveryRow cents={shown.shippingCents} />
      <Separator />
      <div className="flex items-center justify-between text-lg">
        <span className="font-medium">Total</span>
        <span className="font-semibold">
          <Price cents={shown.totalCents} />
        </span>
      </div>
      {signInHint}
      <CheckoutForm
        {...form}
        totalCents={shown.totalCents}
        discountCode={applied?.code ?? null}
        emailRef={emailRef}
        onDiscountRefused={refuse}
      />
    </>
  );
}
