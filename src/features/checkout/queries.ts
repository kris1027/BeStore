import "server-only";

import type Stripe from "stripe";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sessionState } from "@/lib/orders/session-state";
import { PLACEHOLDER_IMAGE, productImageUrl } from "@/lib/product-image";
import { countryDisplayName } from "@/lib/shipping/address";
import { stripe } from "@/lib/stripe";

import { maskEmail } from "./mask-email";
import { type CheckoutPrefill, sessionIdSchema } from "./schemas";

// spec 0007, AC-9: what the customer typed last for this cart, from its newest order whatever its
// status. Only the cart in the visitor's own signed cookie is ever asked for, and a paid order's
// cart is deleted, so this never reaches a paid order. A null column prefills as an empty field.
export async function checkoutPrefill(cartId: string): Promise<CheckoutPrefill | null> {
  const order = await db.order.findFirst({
    where: { cartId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      email: true,
      shipFullName: true,
      shipLine1: true,
      shipLine2: true,
      shipPostalCode: true,
      shipCity: true,
      phone: true,
    },
  });
  if (!order) return null;
  return {
    email: order.email,
    fullName: order.shipFullName ?? "",
    line1: order.shipLine1 ?? "",
    line2: order.shipLine2 ?? "",
    postalCode: order.shipPostalCode ?? "",
    city: order.shipCity ?? "",
    phone: order.phone ?? "",
  };
}

export type DeliveryAddress = {
  readonly fullName: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly postalCode: string;
  readonly city: string;
  readonly countryName: string;
};

export type CompletedOrder = {
  readonly number: number;
  readonly status: "paid" | "shipped" | "delivered" | "cancelled";
  readonly maskedEmail: string;
  readonly currency: string;
  readonly subtotalCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
  // null for an order made before spec 0007: the page then hides the block (AC-13).
  readonly address: DeliveryAddress | null;
  readonly lines: readonly {
    readonly id: string;
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly imageSrc: string;
    readonly unitPriceCents: number;
    readonly quantity: number;
    readonly lineTotalCents: number;
  }[];
};

export type Completion =
  | { readonly state: "paid"; readonly order: CompletedOrder }
  | { readonly state: "confirming"; readonly number: number }
  | { readonly state: "processing"; readonly number: number }
  | { readonly state: "not_completed" };

// spec 0006, AC-11: what /checkout/complete shows for a session id. Read only: whatever Stripe
// or the browser says, this never changes an order; only a verified Stripe event does.
export async function getCompletion(sessionIdParam: unknown): Promise<Completion> {
  const sessionId = sessionIdSchema.safeParse(sessionIdParam);
  if (!sessionId.success) return { state: "not_completed" };

  const order = await db.order.findUnique({
    where: { stripeCheckoutSessionId: sessionId.data },
    select: {
      number: true,
      status: true,
      email: true,
      currency: true,
      subtotalCents: true,
      shippingCents: true,
      totalCents: true,
      shipFullName: true,
      shipLine1: true,
      shipLine2: true,
      shipPostalCode: true,
      shipCity: true,
      shipCountryCode: true,
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productName: true,
          variantLabel: true,
          imagePath: true,
          unitPriceCents: true,
          quantity: true,
          lineTotalCents: true,
        },
      },
    },
  });
  if (!order || order.status === "expired") return { state: "not_completed" };

  if (order.status === "pending_payment") {
    // Only while pending: Stripe tells "paid, the webhook is on its way" from "still processing"
    // from "never paid".
    const session = await stripe.checkout.sessions.retrieve(sessionId.data).then(
      (value): Stripe.Checkout.Session | null => value,
      () => null,
    );
    // Stripe unreachable: keep checking, the refresh will ask again.
    if (session === null) return { state: "confirming", number: order.number };
    switch (sessionState(session)) {
      case "open":
      case "expired":
        return { state: "not_completed" };
      case "processing":
        return { state: "processing", number: order.number };
      // Unknown: never tell someone who may have paid that they did not.
      case "paid":
      case "unknown":
        return { state: "confirming", number: order.number };
    }
  }

  const {
    email,
    lines,
    shipFullName,
    shipLine1,
    shipLine2,
    shipPostalCode,
    shipCity,
    shipCountryCode,
    ...rest
  } = order;
  const address =
    shipFullName !== null &&
    shipLine1 !== null &&
    shipPostalCode !== null &&
    shipCity !== null &&
    shipCountryCode !== null
      ? {
          fullName: shipFullName,
          line1: shipLine1,
          line2: shipLine2,
          postalCode: shipPostalCode,
          city: shipCity,
          countryName: countryDisplayName(shipCountryCode, env.STORE_LOCALE),
        }
      : null;
  return {
    state: "paid",
    order: {
      ...rest,
      status: order.status,
      maskedEmail: maskEmail(email),
      address,
      lines: lines.map(({ imagePath, ...line }) => ({
        ...line,
        imageSrc: imagePath === null ? PLACEHOLDER_IMAGE : productImageUrl(imagePath),
      })),
    },
  };
}
