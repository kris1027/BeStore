import { expect, test } from "@playwright/test";

import { createTestUser, testPassword, withDb } from "../admin/support";
import { seedProduct } from "../catalog/support";
import {
  addToCart,
  cartIdOf,
  hasRealStripeKey,
  payButton,
  postPaidEvent,
  seedPendingOrder,
  termsBox,
} from "../checkout/support";
import { signInAsCustomer } from "./support";

// spec 0012: checkout with an account (AC-15, AC-16) and the account offer after a guest order
// (AC-17).

async function saveDefaultAddress(customerId: string) {
  await withDb((db) =>
    db.query(
      `INSERT INTO customer_addresses (id, customer_id, full_name, line1, city, postal_code,
         country_code, is_default, updated_at)
       VALUES (gen_random_uuid(), $1, 'Anna Kowalska', 'ul. Długa 7', 'Gdańsk', '80-001', 'PL',
         true, now())`,
      [customerId],
    ),
  );
}

test("a guest signs in from checkout and comes back with the merged cart and their address", async ({
  page,
}) => {
  const customer = await createTestUser({ admin: false });
  // The customers row is made on first sign in; the address book needs it.
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await saveDefaultAddress(customer.id);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");

  const socks = await seedProduct({ stock: 10, priceCents: 1500 });
  await addToCart(page, socks, 2);
  await page.goto("/checkout");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/account/sign-in?next=/checkout");
  // The checkout page stays in the DOM, hidden, after a client navigation: query by role.
  await page.getByRole("textbox", { name: "Email" }).fill(customer.email);
  await page.getByRole("textbox", { name: "Password" }).fill(testPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/checkout");
  await expect(page.getByText("2 × €15.00")).toBeVisible();
  const email = page.getByRole("textbox", { name: "Email" });
  await expect(email).toHaveValue(customer.email);
  await expect(email).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Address line 1")).toHaveValue("ul. Długa 7");
  await expect(page.getByLabel("Postal code")).toHaveValue("80-001");
  await expect(
    page.getByRole("checkbox", { name: "Save this address to my account" }),
  ).toBeChecked();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);

  // A saved address can be swapped in.
  await page.getByLabel("Address line 1").fill("somewhere else");
  await page
    .getByLabel("Saved addresses")
    .selectOption({ label: "Anna Kowalska, ul. Długa 7, 80-001 Gdańsk" });
  await expect(page.getByLabel("Address line 1")).toHaveValue("ul. Długa 7");
});

test("a signed in Pay goes to Stripe with the account on the order and the address saved", async ({
  page,
}) => {
  test.skip(!hasRealStripeKey, "needs a real Stripe test key (STRIPE_SECRET_KEY)");
  const customer = await createTestUser({ admin: false });
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  const socks = await seedProduct({ stock: 10, priceCents: 1500 });
  await addToCart(page, socks);
  await page.goto("/checkout");
  await expect(payButton(page)).toBeEnabled();
  await page.getByLabel("Full name").fill("Anna Kowalska");
  await page.getByLabel("Address line 1").fill("ul. Marszałkowska 1");
  await page.getByLabel("Postal code").fill("00950");
  await page.getByLabel("City").fill("Warsaw");
  await termsBox(page).check();
  await payButton(page).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });

  const row = await withDb((db) =>
    db.query<{ customer_id: string; email: string; saved: number }>(
      `SELECT o.customer_id, o.email,
         (SELECT count(*)::int FROM customer_addresses a WHERE a.customer_id = $1) AS saved
       FROM orders o WHERE o.customer_id = $1`,
      [customer.id],
    ),
  );
  expect(row.rows[0]).toMatchObject({ customer_id: customer.id, email: customer.email, saved: 1 });
});

test("a guest's paid order offers an account, which sends the confirm email to the order's email", async ({
  page,
  request,
}) => {
  const socks = await seedProduct({ stock: 10, priceCents: 1500 });
  await addToCart(page, socks);
  const email = `e2e-offer-${Date.now()}@example.com`;
  const order = await seedPendingOrder(await cartIdOf(page), socks, {
    quantity: 1,
    priceCents: 1500,
    email,
    shippingCents: 0,
  });
  expect((await postPaidEvent(request, order)).status()).toBe(200);

  await page.goto(`/checkout/complete?session_id=${order.sessionId}`);
  await expect(page.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();
  await page.getByRole("button", { name: "Create an account to track this order" }).click();
  await expect(page.getByText(/Check your email/)).toBeVisible();

  await expect
    .poll(async () => {
      const search = await fetch(
        `http://127.0.0.1:55324/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
      );
      return ((await search.json()) as { messages_count: number }).messages_count;
    })
    .toBe(1);
});

test("a signed in visitor sees no account offer on the confirmation page", async ({
  page,
  request,
}) => {
  const customer = await createTestUser({ admin: false });
  const socks = await seedProduct({ stock: 10, priceCents: 1500 });
  await addToCart(page, socks);
  const order = await seedPendingOrder(await cartIdOf(page), socks, {
    quantity: 1,
    priceCents: 1500,
    email: `e2e-other-${Date.now()}@example.com`,
  });
  expect((await postPaidEvent(request, order)).status()).toBe(200);
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");

  await page.goto(`/checkout/complete?session_id=${order.sessionId}`);
  await expect(page.getByRole("heading", { name: "Thank you for your order" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create an account to track this order" }),
  ).toHaveCount(0);
});
