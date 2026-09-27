import { expect, type Page, test } from "@playwright/test";

import { seedProduct } from "../catalog/support";
import { addToCart, stockOf } from "./support";

// @stripe, local only (spec 0006): a real payment on Stripe's hosted page, confirmed by the real
// webhook. Needs a Stripe test key in .env.local and, in another terminal:
//   stripe listen --forward-to localhost:3000/api/stripe/webhook --events \
//     checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired
// Run with: STRIPE_E2E=1 pnpm test:e2e --grep @stripe --project desktop

test.skip(!process.env.STRIPE_E2E, "set STRIPE_E2E=1 with `stripe listen` running");

async function payOnStripe(page: Page, card: string) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  await page.getByLabel("Card number").fill(card);
  await page.getByLabel("Expiration").fill("12 / 34");
  await page.getByLabel("CVC").fill("123");
  await page.getByLabel("Cardholder name").fill("Ada Lovelace");
  const country = page.getByLabel("Country or region");
  if (await country.isVisible()) await country.selectOption("PL");
  await page.getByTestId("hosted-payment-submit-button").click();
}

test("@stripe a card payment ends in one paid order that took the stock", async ({ page }) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks, 2);
  await page.goto("/checkout");
  await page.getByLabel("Email").fill("stripe.e2e@example.com");
  await page.getByRole("button", { name: "Pay €25.00" }).click();

  await payOnStripe(page, "4242 4242 4242 4242");

  await page.waitForURL(/\/checkout\/complete\?session_id=cs_test_/, { timeout: 60_000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Thank you for your order" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  expect(await stockOf(socks.variantId)).toBe(3);
});

test("@stripe a declined card leaves no paid order", async ({ page }) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  await page.goto("/checkout");
  await page.getByLabel("Email").fill("stripe.e2e@example.com");
  await page.getByRole("button", { name: "Pay €12.50" }).click();

  await payOnStripe(page, "4000 0000 0000 0002");

  await expect(page.getByText(/declined/i)).toBeVisible({ timeout: 30_000 });
  expect(await stockOf(socks.variantId)).toBe(5);
});
