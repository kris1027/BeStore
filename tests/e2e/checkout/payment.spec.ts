import { expect, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { createTestUser, injectSession, signInFully } from "../admin/support";
import { seedProduct } from "../catalog/support";
import {
  addToCart,
  cartIdOf,
  fillCheckout,
  hasRealStripeKey,
  payButton,
  postPaidEvent,
  seedPendingOrder,
  stockOf,
} from "./support";

// Spec 0006: the checkout form, the signed webhook, the confirmation page and the admin list.

test("an invalid email shows a field error and nothing leaves the page", async ({ page }) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  await page.goto("/checkout");

  await fillCheckout(page, "not-an-email");
  await payButton(page).click();

  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL("/checkout");
  await expectNoA11yViolations(page);
});

test("coming back from Stripe without paying shows the notice and keeps the cart", async ({
  page,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks, 2);

  await page.goto("/checkout?cancelled=1");

  await expect(page.getByText("Payment was not completed. Your cart is saved.")).toBeVisible();
  await expect(page.getByText("2 × €12.50")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("Pay sends the customer to Stripe's hosted page", async ({ page }) => {
  test.skip(!hasRealStripeKey, "needs a real Stripe test key (STRIPE_SECRET_KEY)");
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  await page.goto("/checkout");

  await fillCheckout(page);
  await payButton(page).click();

  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });
});

test("a paid webhook turns the checkout into a paid order the customer and admin both see", async ({
  page,
  browser,
  request,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks, 2);
  const order = await seedPendingOrder(await cartIdOf(page), socks, {
    quantity: 2,
    priceCents: 1250,
  });

  // Before the webhook: the page waits for it and never marks anything paid itself.
  const unsigned = await request.post("/api/stripe/webhook", { data: "{}" });
  expect(unsigned.status()).toBe(400);

  const response = await postPaidEvent(request, order);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ received: true, result: "paid" });
  expect(await stockOf(socks.variantId)).toBe(3);

  const complete = await page.goto(`/checkout/complete?session_id=${order.sessionId}`);
  expect(complete?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(
    page.getByRole("heading", { level: 1, name: "Thank you for your order" }),
  ).toBeVisible();
  await expect(page.getByText(`#${order.number}`)).toBeVisible();
  await expect(page.getByText("e•••@example.com")).toBeVisible();
  await expect(page.getByText(socks.name)).toBeVisible();
  // The cart went with the payment.
  await expect(page.getByRole("link", { name: "Cart", exact: true })).toBeVisible();
  await expectNoA11yViolations(page);

  const admin = await createTestUser({ enrolled: true });
  const adminPage = await (await browser.newContext()).newPage();
  await signInFully(adminPage, admin);
  await adminPage.goto("/admin/orders");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
  const row = adminPage.getByRole("row", { name: new RegExp(`#${order.number}`) });
  await expect(row).toContainText("Paid");
  await expect(row).toContainText("€25.00");
  await expectNoA11yViolations(adminPage);

  await row.getByRole("link", { name: `#${order.number}` }).click();
  await expect(
    adminPage.getByRole("heading", { level: 1, name: `Order #${order.number}` }),
  ).toBeVisible();
  await expect(adminPage.getByRole("cell", { name: socks.name })).toBeVisible();
  await expect(adminPage.getByText("Awaiting payment → Paid")).toBeVisible();
  await expectNoA11yViolations(adminPage);
});

test("an unknown session id shows payment not completed", async ({ page }) => {
  await page.goto("/checkout/complete?session_id=cs_test_doesnotexist");

  await expect(
    page.getByRole("heading", { level: 1, name: "Payment not completed" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to checkout" })).toHaveAttribute(
    "href",
    "/checkout",
  );
  await expectNoA11yViolations(page);
});

test("the admin order pages send a signed out visitor to sign in and 404 for a non admin", async ({
  page,
}) => {
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/admin\/sign-in\?next=%2Fadmin%2Forders/);

  const customer = await createTestUser({ admin: false });
  await injectSession(page, customer);
  for (const path of ["/admin/orders", "/admin/orders/1001"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  }
});

test("the checkout form works by keyboard alone", async ({ page }) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  await page.goto("/checkout");
  await expect(payButton(page)).toBeEnabled();

  await page.getByLabel("Email").focus();
  await page.keyboard.type("bad");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeFocused();
});

test("the confirmation page works by keyboard alone", async ({ page }) => {
  await page.goto("/checkout/complete?session_id=cs_test_doesnotexist");
  const back = page.getByRole("link", { name: "Return to checkout" });
  await expect(back).toBeVisible();

  await tabTo(page, back);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/checkout");
});

test("the admin order pages work by keyboard alone", async ({ page, browser, request }) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  const order = await seedPendingOrder(await cartIdOf(page), socks, {
    quantity: 1,
    priceCents: 1250,
  });
  expect((await postPaidEvent(request, order)).status()).toBe(200);

  const admin = await createTestUser({ enrolled: true });
  const adminPage = await (await browser.newContext()).newPage();
  await signInFully(adminPage, admin);
  await adminPage.goto("/admin/orders");
  await expect(adminPage.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();

  // spec 0010, AC-1: find the order by its number from the search box.
  const search = adminPage.getByLabel("Order number, email or name");
  await tabTo(adminPage, search);
  await adminPage.keyboard.type(String(order.number));
  await adminPage.keyboard.press("Enter");
  await expect(adminPage).toHaveURL(new RegExp(`q=${order.number}`));

  const orderLink = adminPage.getByRole("link", { name: `#${order.number}` });
  await tabTo(adminPage, orderLink);
  await adminPage.keyboard.press("Enter");
  await expect(
    adminPage.getByRole("heading", { level: 1, name: `Order #${order.number}` }),
  ).toBeVisible();

  const backLink = adminPage.getByRole("main").getByRole("link", { name: "All orders" });
  await tabTo(adminPage, backLink);
  await adminPage.keyboard.press("Enter");
  await expect(adminPage).toHaveURL("/admin/orders");
});
