import { describe, expect, it } from "vitest";

import { checkoutSessionParams, type SessionOrder } from "./stripe-session";

// spec 0006, AC-1 and API surface; spec 0007, AC-6.

const order: SessionOrder = {
  orderId: "0192f1c2-0000-7000-8000-000000000001",
  number: 1001,
  email: "ada@example.com",
  currency: "EUR",
  lines: [
    {
      productName: "Tee",
      variantLabel: "M / Navy",
      unitPriceCents: 2500,
      quantity: 2,
      imageUrl: "https://cdn.example.com/tee.jpg",
    },
    {
      productName: "Socks",
      variantLabel: null,
      unitPriceCents: 900,
      quantity: 1,
      imageUrl: "http://127.0.0.1:55321/socks.jpg",
    },
  ],
  shippingCents: 1500,
  shipping: {
    fullName: "Anna Kowalska",
    line1: "ul. Marszałkowska 1",
    line2: "m. 4",
    city: "Warsaw",
    postalCode: "00-950",
    countryCode: "PL",
    phone: "+48 600 100 200",
  },
};

const nowMs = Date.UTC(2026, 8, 27, 12, 0, 0);

describe("checkoutSessionParams", () => {
  const params = checkoutSessionParams(order, { siteUrl: "https://shop.example/", nowMs });

  it("charges exactly the order's lines, priced inline", () => {
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([
      {
        quantity: 2,
        price_data: {
          currency: "eur",
          unit_amount: 2500,
          product_data: { name: "Tee / M / Navy", images: ["https://cdn.example.com/tee.jpg"] },
        },
      },
      {
        quantity: 1,
        price_data: { currency: "eur", unit_amount: 900, product_data: { name: "Socks" } },
      },
    ]);
    expect(params).not.toHaveProperty("payment_method_types");
  });

  it("ties the session and its payment to the order", () => {
    expect(params.client_reference_id).toBe(order.orderId);
    expect(params.metadata).toEqual({ order_id: order.orderId });
    expect(params.payment_intent_data).toMatchObject({
      metadata: { order_id: order.orderId },
      description: "Order #1001",
    });
    expect(params.customer_email).toBe("ada@example.com");
  });

  it("charges the order's delivery as its one fixed shipping option", () => {
    expect(params.shipping_options).toEqual([
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: 1500, currency: "eur" },
          display_name: "Standard delivery",
        },
      },
    ]);
  });

  it("names a free delivery", () => {
    const free = checkoutSessionParams({ ...order, shippingCents: 0 }, { siteUrl: "", nowMs });

    expect(free.shipping_options).toEqual([
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: 0, currency: "eur" },
          display_name: "Free delivery",
        },
      },
    ]);
  });

  it("sends the delivery address and phone with the payment", () => {
    expect(params.payment_intent_data?.shipping).toEqual({
      name: "Anna Kowalska",
      address: {
        line1: "ul. Marszałkowska 1",
        line2: "m. 4",
        city: "Warsaw",
        postal_code: "00-950",
        country: "PL",
      },
      phone: "+48 600 100 200",
    });
  });

  it("leaves out line 2 and the phone when they are empty, never sending blank strings", () => {
    const bare = checkoutSessionParams(
      { ...order, shipping: { ...order.shipping, line2: null, phone: null } },
      { siteUrl: "", nowMs },
    );

    expect(bare.payment_intent_data?.shipping).toEqual({
      name: "Anna Kowalska",
      address: {
        line1: "ul. Marszałkowska 1",
        city: "Warsaw",
        postal_code: "00-950",
        country: "PL",
      },
    });
  });

  it("expires just over 30 minutes out and returns to the store", () => {
    const expiresInSeconds = (params.expires_at ?? 0) - nowMs / 1000;
    expect(expiresInSeconds).toBeGreaterThanOrEqual(30 * 60);
    expect(expiresInSeconds).toBeLessThanOrEqual(32 * 60);
    expect(params.success_url).toBe(
      "https://shop.example/checkout/complete?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(params.cancel_url).toBe("https://shop.example/checkout?cancelled=1");
  });

  it("charges every line in the order's own currency, lower cased for Stripe", () => {
    const pln = checkoutSessionParams({ ...order, currency: "PLN" }, { siteUrl: "", nowMs });

    expect(pln.line_items?.map((item) => item.price_data?.currency)).toEqual(["pln", "pln"]);
    expect(pln.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.currency).toBe("pln");
  });
});
