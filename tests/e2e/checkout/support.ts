import { randomUUID } from "node:crypto";

import { type APIRequestContext, expect, type Page } from "@playwright/test";
import Stripe from "stripe";

import { withDb } from "../admin/support";
import type { SeededProduct } from "../catalog/support";

// The payment flow without Stripe's hosted page: the pending order startCheckout would create,
// then the webhook Stripe would send, signed with the app's own STRIPE_WEBHOOK_SECRET. The real
// hosted page runs in the @stripe spec (local only).

// A real test key reaches Stripe; CI on a fork (no secret) runs on a placeholder.
export const hasRealStripeKey =
  /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? "") &&
  !process.env.STRIPE_SECRET_KEY?.includes("placeholder");

const offlineStripe = new Stripe("sk_test_offline");

function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set; the checkout e2e tests sign events with it.",
    );
  return secret;
}

export async function addToCart(page: Page, product: SeededProduct, quantity = 1) {
  await page.goto(`/products/${product.slug}`);
  await page.getByLabel("Quantity").fill(String(quantity));
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
}

// A valid Polish delivery address (spec 0007), typed the way a customer would.
export const testAddress = {
  fullName: "Anna Kowalska",
  line1: "ul. Marszałkowska 1",
  postalCode: "00950",
  city: "Warsaw",
} as const;

export async function fillCheckout(page: Page, email = "e2e.customer@example.com") {
  // Pay is enabled once the form has hydrated; typing earlier could be overwritten.
  await expect(payButton(page)).toBeEnabled();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill(testAddress.fullName);
  await page.getByLabel("Address line 1").fill(testAddress.line1);
  await page.getByLabel("Postal code").fill(testAddress.postalCode);
  await page.getByLabel("City").fill(testAddress.city);
}

// The Pay button whatever the delivery fee: the store_settings row is shared by every spec file
// running at the same time, so only tests/e2e/admin/settings.spec.ts (desktop, serial) asserts
// on the amount.
export function payButton(page: Page) {
  return page.getByRole("button", { name: /^Pay / });
}

export async function cartIdOf(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find((c) => c.name === "bestore_cart");
  const cartId = cookie?.value.split(".")[0];
  if (!cartId) throw new Error("No cart cookie");
  return cartId;
}

export type SeededOrder = {
  readonly id: string;
  readonly number: number;
  readonly sessionId: string;
  readonly totalCents: number;
};

// What startCheckout writes for a one line cart, with a made up session id.
export async function seedPendingOrder(
  cartId: string,
  product: SeededProduct,
  options: {
    readonly quantity: number;
    readonly priceCents: number;
    readonly email?: string;
    // Writes testAddress (stored form) and this delivery fee, as spec 0007's startCheckout does.
    readonly shippingCents?: number;
  },
): Promise<SeededOrder> {
  const sessionId = `cs_test_e2e${randomUUID().replace(/-/g, "")}`;
  const subtotal = options.quantity * options.priceCents;
  const shipping = options.shippingCents;
  const total = subtotal + (shipping ?? 0);
  return withDb(async (db) => {
    const order = await db.query<{ id: string; number: number }>(
      `INSERT INTO orders (id, cart_id, email, currency, subtotal_cents, shipping_cents, total_cents,
         stripe_checkout_session_id, ship_full_name, ship_line1, ship_city, ship_postal_code,
         ship_country_code, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'EUR', $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       RETURNING id, number`,
      [
        cartId,
        options.email ?? "e2e.customer@example.com",
        subtotal,
        shipping ?? 0,
        total,
        sessionId,
        ...(shipping === undefined
          ? [null, null, null, null, null]
          : [testAddress.fullName, testAddress.line1, testAddress.city, "00-950", "PL"]),
      ],
    );
    const { id, number } = order.rows[0]!;
    const sku = await db.query<{ sku: string }>("SELECT sku FROM product_variants WHERE id = $1", [
      product.variantId,
    ]);
    await db.query(
      `INSERT INTO order_lines (id, order_id, variant_id, product_id, product_name, sku,
         unit_price_cents, quantity, line_total_cents)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        product.variantId,
        product.id,
        product.name,
        sku.rows[0]!.sku,
        options.priceCents,
        options.quantity,
        subtotal,
      ],
    );
    await db.query(
      `INSERT INTO order_events (id, order_id, type, to_status, actor_type)
       VALUES (gen_random_uuid(), $1, 'created', 'pending_payment', 'customer')`,
      [id],
    );
    return { id, number, sessionId, totalCents: total };
  });
}

export async function postPaidEvent(request: APIRequestContext, order: SeededOrder) {
  const event = {
    id: `evt_e2e_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
    data: {
      object: {
        id: order.sessionId,
        object: "checkout.session",
        status: "complete",
        payment_status: "paid",
        amount_total: order.totalCents,
        currency: "eur",
        payment_intent: `pi_e2e_${randomUUID().replace(/-/g, "")}`,
        metadata: { order_id: order.id },
      },
    },
  };
  const payload = JSON.stringify(event);
  return request.post("/api/stripe/webhook", {
    data: payload,
    headers: {
      "content-type": "application/json",
      "stripe-signature": offlineStripe.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret(),
      }),
    },
  });
}

export async function stockOf(variantId: string): Promise<number> {
  return withDb(async (db) => {
    const row = await db.query<{ stock_quantity: number }>(
      "SELECT stock_quantity FROM product_variants WHERE id = $1",
      [variantId],
    );
    return row.rows[0]!.stock_quantity;
  });
}
