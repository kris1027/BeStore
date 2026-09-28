import "server-only";

import type Stripe from "stripe";

import { db } from "@/lib/db";
import { PLACEHOLDER_IMAGE, productImageUrl } from "@/lib/product-image";
import { stripe } from "@/lib/stripe";

import { maskEmail } from "./mask-email";
import { sessionIdSchema } from "./schemas";

export type CompletedOrder = {
  readonly number: number;
  readonly status: "paid" | "shipped" | "delivered" | "cancelled";
  readonly maskedEmail: string;
  readonly currency: string;
  readonly subtotalCents: number;
  readonly shippingCents: number;
  readonly totalCents: number;
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
    if (session.status !== "complete") return { state: "not_completed" };
    return session.payment_status === "unpaid"
      ? { state: "processing", number: order.number }
      : { state: "confirming", number: order.number };
  }

  const { email, lines, ...rest } = order;
  return {
    state: "paid",
    order: {
      ...rest,
      status: order.status,
      maskedEmail: maskEmail(email),
      lines: lines.map(({ imagePath, ...line }) => ({
        ...line,
        imageSrc: imagePath === null ? PLACEHOLDER_IMAGE : productImageUrl(imagePath),
      })),
    },
  };
}
