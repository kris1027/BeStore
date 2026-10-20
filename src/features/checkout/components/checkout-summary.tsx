import { InfoIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import type { CalendarDayText } from "@/lib/dates";
import { inlineLinkClass } from "@/components/inline-link";
import { Price } from "@/components/price";
import { ProductImage } from "@/components/product-image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { loadOwnedCart } from "@/lib/cart/owned";
import { addressNeedsCheck } from "@/lib/customer/address-rules";
import { listSavedAddresses, type SavedAddress } from "@/lib/customer/addresses";
import { getCustomer } from "@/lib/customer/session";
import { previewDiscount } from "@/lib/discounts/codes";
import { refusalMessage } from "@/lib/discounts/rule";
import { env } from "@/lib/env";
import { countryDisplayName } from "@/lib/shipping/address";
import { orderCharges } from "@/lib/shipping/rule";
import { getShippingSettings } from "@/lib/shipping/settings";

import { checkoutPrefill, prefillDiscountCode } from "../queries";
import { type CheckoutPrefill, emptyPrefill } from "../schemas";
import type { CheckoutAccount } from "./checkout-form";
import { CheckoutPayment, type InitialDiscount } from "./checkout-payment";

// spec 0012, AC-16: where a signed out visitor signs in and comes back.
const signInToCheckout = "/account/sign-in?next=/checkout";

function addressValues(address: SavedAddress): Omit<CheckoutPrefill, "email"> {
  return {
    fullName: address.fullName,
    line1: address.line1,
    line2: address.line2 ?? "",
    postalCode: address.postalCode,
    city: address.city,
    phone: address.phone ?? "",
  };
}

const cartPath = "/cart";

// spec 0005, AC-13: reread on the server, never trusted from the cart page. No cart, an empty
// one, or any flagged line goes back to the cart, where the reason shows. spec 0006 adds the
// email form and Pay button, and the notice after coming back from Stripe without paying. spec
// 0007 adds the address fields, prefilled from the cart's last order, and the delivery row. The
// fee shown here is for display; Pay computes it again from the live settings row (AC-5).
// spec 0014 adds the promo code field and, for a return visit, the code from the last Pay
// (AC-9); Pay checks the code again under its lock.
export async function CheckoutSummary({
  searchParams,
  termsVersion,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
  // spec 0017, AC-9: the current terms version, which Pay sends back.
  readonly termsVersion: CalendarDayText;
}) {
  const [cart, params] = await Promise.all([loadOwnedCart(), searchParams]);
  if (!cart || !cart.canCheckout) redirect(cartPath);
  const cancelled = params.cancelled === "1";
  const [settings, orderPrefill, returningCode, customer] = await Promise.all([
    getShippingSettings(),
    checkoutPrefill(cart.id),
    prefillDiscountCode(cart.id),
    getCustomer(),
  ]);
  // spec 0012, AC-15: a signed in customer's form starts with the pending order's address for this
  // cart, else the default saved address; saved addresses the rules now refuse are left out.
  const saved =
    customer === null
      ? []
      : (await listSavedAddresses(customer.id)).filter(
          (address) => !addressNeedsCheck(address, env.STORE_COUNTRY),
        );
  const account: CheckoutAccount | null =
    customer === null
      ? null
      : {
          email: customer.email,
          addresses: saved.map((address) => ({
            id: address.id,
            label: `${address.fullName}, ${address.line1}, ${address.postalCode} ${address.city}`,
            values: addressValues(address),
          })),
        };
  const defaultAddress = saved.find((address) => address.isDefault);
  const prefill =
    orderPrefill ??
    (defaultAddress ? { email: "", ...addressValues(defaultAddress) } : null) ??
    emptyPrefill;
  const { shippingCents: shipping, totalCents } = orderCharges(
    { subtotalCents: cart.subtotalCents, discountCents: 0 },
    settings,
  );
  const initialDiscount =
    returningCode === null
      ? null
      : await returningDiscount(
          cart.id,
          returningCode.code,
          customer?.email ?? returningCode.email,
        );

  return (
    <div className="flex flex-col gap-8">
      {cancelled ? (
        <Alert role="status">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>Payment was not completed. Your cart is saved.</AlertTitle>
          <AlertDescription>You can pay whenever you are ready.</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid items-start gap-10 lg:grid-cols-3">
        <section aria-labelledby="order-heading" className="flex flex-col gap-4 lg:col-span-2">
          <h2 id="order-heading" className="font-heading text-2xl">
            Your order
          </h2>
          <ul className="flex flex-col">
            {cart.lines.map((line, index) => (
              <li key={line.id} className="flex flex-col">
                {index > 0 ? <Separator /> : null}
                <div className="flex items-center gap-4 py-4">
                  <ProductImage
                    src={line.image.src}
                    alt={line.image.alt}
                    sizes="64px"
                    className="w-16 shrink-0"
                  />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <p className="font-medium">{line.productName}</p>
                    {line.variantLabel ? (
                      <p className="text-sm text-muted-foreground">{line.variantLabel}</p>
                    ) : null}
                    <p className="text-sm text-muted-foreground">
                      {line.quantity} × <Price cents={line.priceCents} />
                    </p>
                  </div>
                  <p className="font-medium">
                    <Price cents={line.totalCents} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <Link
            href={cartPath}
            className="self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Edit your cart
          </Link>
        </section>
        <section
          aria-labelledby="checkout-summary-heading"
          className="flex flex-col gap-4 rounded-md border bg-muted/40 p-6"
        >
          <h2 id="checkout-summary-heading" className="font-heading text-2xl">
            Summary
          </h2>
          {/* Keyed by who is paying: signing in and coming back (a client navigation that keeps
              the old form around) starts the form over with the account's email and address. */}
          <CheckoutPayment
            key={customer?.id ?? "guest"}
            subtotalCents={cart.subtotalCents}
            shippingCents={shipping}
            totalCents={totalCents}
            initialDiscount={initialDiscount}
            signInHint={
              customer === null ? (
                <p className="text-sm text-muted-foreground">
                  Have an account?{" "}
                  <Link href={signInToCheckout} className={inlineLinkClass}>
                    Sign in
                  </Link>
                </p>
              ) : null
            }
            country={env.STORE_COUNTRY}
            countryName={countryDisplayName(env.STORE_COUNTRY, env.STORE_LOCALE)}
            prefill={prefill}
            account={account}
            termsVersion={termsVersion}
          />
        </section>
      </div>
    </div>
  );
}

// spec 0014, AC-9: a code from an earlier Pay shows applied when it still passes, else in the
// field with its refusal. The same previewDiscount as Apply, so the render and the button agree.
async function returningDiscount(
  cartId: string,
  code: string,
  email: string | null,
): Promise<InitialDiscount> {
  const preview = await previewDiscount({ cartId, codeText: code, email });
  switch (preview.kind) {
    case "applied":
      return {
        kind: "applied",
        applied: {
          code: preview.code,
          discountCents: preview.discountCents,
          shippingCents: preview.shippingCents,
          totalCents: preview.totalCents,
        },
      };
    case "refused":
      return {
        kind: "refused",
        text: code,
        message: refusalMessage(preview, {
          currency: env.STORE_CURRENCY,
          locale: env.STORE_LOCALE,
        }),
      };
    default:
      return null;
  }
}

export function CheckoutSummarySkeleton() {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-3" aria-hidden="true">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
