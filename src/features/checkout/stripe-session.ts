import type Stripe from "stripe";

// Pure: an order to the Stripe Checkout Session that charges exactly its lines (spec 0006,
// API surface). Inline price_data, so Stripe never holds a catalog of its own.

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
  return {
    mode: "payment",
    // No payment_method_types: the methods switched on in the Stripe dashboard apply.
    line_items: order.lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency: order.currency.toLowerCase(),
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
    payment_intent_data: { metadata, description: `Order #${order.number}` },
    expires_at: Math.floor(options.nowMs / 1000) + SESSION_LIFETIME_SECONDS,
    success_url: `${site}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/checkout?cancelled=1`,
  };
}
