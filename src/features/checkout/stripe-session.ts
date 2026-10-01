import type Stripe from "stripe";

import type { ShipTo } from "@/lib/shipping/address";
import { deliveryLabel } from "@/lib/shipping/rule";

// Pure: an order to the Stripe Checkout Session that charges exactly its lines and its delivery
// (spec 0006, API surface; spec 0007, AC-6). Inline price_data and shipping_rate_data, so Stripe
// never holds a catalog or a rate of its own, and its amount_total equals the order's total.

export type SessionOrder = {
  readonly orderId: string;
  readonly number: number;
  readonly email: string;
  readonly currency: string;
  readonly lines: readonly {
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly unitPriceCents: number;
    readonly quantity: number;
    readonly imageUrl: string | null;
  }[];
  readonly shippingCents: number;
  readonly shipping: ShipTo;
};

// Stripe's shortest allowed lifetime is 30 minutes from when it receives the request, so the
// minute on top keeps a slow request from landing just under it.
export const SESSION_LIFETIME_SECONDS = 31 * 60;

export function checkoutSessionParams(
  order: SessionOrder,
  options: { readonly siteUrl: string; readonly nowMs: number },
): Stripe.Checkout.SessionCreateParams {
  const site = options.siteUrl.replace(/\/+$/, "");
  const metadata = { order_id: order.orderId };
  const currency = order.currency.toLowerCase();
  const { shipping } = order;
  return {
    mode: "payment",
    // No payment_method_types: the methods switched on in the Stripe dashboard apply.
    line_items: order.lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency,
        unit_amount: line.unitPriceCents,
        product_data: {
          name: line.variantLabel ? `${line.productName} / ${line.variantLabel}` : line.productName,
          // Stripe fetches images itself, so a local http URL would only fail.
          ...(line.imageUrl?.startsWith("https://") ? { images: [line.imageUrl] } : {}),
        },
      },
    })),
    customer_email: order.email,
    client_reference_id: order.orderId,
    metadata,
    // One fixed rate, computed on our side: the customer already chose delivery on /checkout.
    // No delivery estimate, the store has not committed to delivery times.
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: order.shippingCents, currency },
          display_name: deliveryLabel(order.shippingCents),
        },
      },
    ],
    payment_intent_data: {
      metadata,
      description: `Order #${order.number}`,
      // Empty optional fields are left out, never sent as "".
      shipping: {
        name: shipping.fullName,
        address: {
          line1: shipping.line1,
          ...(shipping.line2 === null ? {} : { line2: shipping.line2 }),
          city: shipping.city,
          postal_code: shipping.postalCode,
          country: shipping.countryCode,
        },
        ...(shipping.phone === null ? {} : { phone: shipping.phone }),
      },
    },
    expires_at: Math.floor(options.nowMs / 1000) + SESSION_LIFETIME_SECONDS,
    success_url: `${site}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/checkout?cancelled=1`,
  };
}
