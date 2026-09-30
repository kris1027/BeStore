import { expect, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { createTestUser, signInFully } from "../admin/support";
import { seedProduct } from "../catalog/support";
import {
  addToCart,
  cartIdOf,
  payButton,
  postPaidEvent,
  seedPendingOrder,
  testAddress,
} from "./support";

// spec 0007: the delivery address at checkout, the prefill, and the address on the confirmation
// and admin pages. These never change store_settings (see tests/e2e/admin/settings.spec.ts), so
// they assert labels, not the fee.

test("the checkout form asks for a delivery address with labels and autocomplete", async ({
  page,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  await page.goto("/checkout");

  const fields = [
    ["Email", "email"],
    ["Full name", "shipping name"],
    ["Address line 1", "shipping address-line1"],
    ["Address line 2 (optional)", "shipping address-line2"],
    ["Postal code", "shipping postal-code"],
    ["City", "shipping address-level2"],
    ["Phone (optional)", "tel"],
  ] as const;
  for (const [label, token] of fields) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("autocomplete", token);
  }
  // The one country the store ships to, shown as text, never as an input.
  await expect(page.getByRole("definition").filter({ hasText: "Poland" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /country/i })).toHaveCount(0);
  await expect(page.getByText(/^(Standard delivery|Free delivery)$/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test("invalid address fields each show their message and focus moves to the first", async ({
  page,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  await page.goto("/checkout");
  await expect(payButton(page)).toBeEnabled();

  await page.getByLabel("Email").fill("e2e.customer@example.com");
  await page.getByLabel("Full name").fill("   ");
  await page.getByLabel("Postal code").fill("00 950");
  await page.getByLabel("Phone (optional)").fill("123");
  await payButton(page).click();

  await expect(page.getByText("Enter your full name.")).toBeVisible();
  await expect(page.getByText("Enter your street address.")).toBeVisible();
  await expect(page.getByText("Enter a postal code like 00-950.")).toBeVisible();
  await expect(page.getByText("Enter your city.")).toBeVisible();
  await expect(
    page.getByText("Enter a phone number with 7 to 15 digits, or leave it empty."),
  ).toBeVisible();
  await expect(page.getByLabel("Full name")).toBeFocused();
  await expect(page.getByLabel("Postal code")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Email")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL("/checkout");
  await expectNoA11yViolations(page);
});

test("the address fields work by keyboard alone", async ({ page }) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  await page.goto("/checkout");
  await expect(payButton(page)).toBeEnabled();

  const email = page.getByLabel("Email");
  await tabTo(page, email);
  await page.keyboard.type("e2e.customer@example.com");
  for (const value of [testAddress.fullName, testAddress.line1, "", "12", testAddress.city]) {
    await page.keyboard.press("Tab");
    if (value) await page.keyboard.type(value);
  }
  await page.keyboard.press("Enter");

  await expect(page.getByText("Enter a postal code like 00-950.")).toBeVisible();
  await expect(page.getByLabel("Postal code")).toBeFocused();
});

test("coming back to checkout fills in what was typed for this cart; a new cart starts empty", async ({
  page,
  browser,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  await seedPendingOrder(await cartIdOf(page), socks, {
    quantity: 1,
    priceCents: 1250,
    email: "back.again@example.com",
    shippingCents: 0,
  });

  await page.goto("/checkout?cancelled=1");

  await expect(page.getByLabel("Email")).toHaveValue("back.again@example.com");
  await expect(page.getByLabel("Full name")).toHaveValue(testAddress.fullName);
  await expect(page.getByLabel("Address line 1")).toHaveValue(testAddress.line1);
  await expect(page.getByLabel("Address line 2 (optional)")).toHaveValue("");
  await expect(page.getByLabel("Postal code")).toHaveValue("00-950");
  await expect(page.getByLabel("City")).toHaveValue(testAddress.city);

  const fresh = await (await browser.newContext()).newPage();
  await addToCart(fresh, socks);
  await fresh.goto("/checkout");
  await expect(fresh.getByLabel("Email")).toHaveValue("");
  await expect(fresh.getByLabel("Full name")).toHaveValue("");
});

test("a paid order shows where it goes, to the customer and to the admin", async ({
  page,
  browser,
  request,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  const order = await seedPendingOrder(await cartIdOf(page), socks, {
    quantity: 1,
    priceCents: 1250,
    shippingCents: 990,
  });
  expect((await postPaidEvent(request, order)).status()).toBe(200);

  await page.goto(`/checkout/complete?session_id=${order.sessionId}`);
  await expect(page.getByRole("heading", { level: 2, name: "Delivering to" })).toBeVisible();
  const delivering = page.locator("address");
  await expect(delivering).toContainText(testAddress.fullName);
  await expect(delivering).toContainText("00-950 Warsaw");
  await expect(delivering).toContainText("Poland");
  await expect(page.getByText("Standard delivery")).toBeVisible();
  await expect(page.getByText("€9.90")).toBeVisible();
  await expect(page.getByText("€22.40")).toBeVisible();
  await expectNoA11yViolations(page);

  const admin = await createTestUser({ enrolled: true });
  const adminPage = await (await browser.newContext()).newPage();
  await signInFully(adminPage, admin);
  await adminPage.goto("/admin/orders");
  const row = adminPage.getByRole("row", { name: new RegExp(`#${order.number}`) });
  await expect(row).toContainText(`${testAddress.fullName}, ${testAddress.city}`);
  await expectNoA11yViolations(adminPage);

  await row.getByRole("link", { name: `#${order.number}` }).click();
  await expect(
    adminPage.getByRole("heading", { level: 1, name: `Order #${order.number}` }),
  ).toBeVisible();
  const address = adminPage.locator("address");
  await expect(address).toContainText(testAddress.line1);
  await expect(address).toContainText("00-950 Warsaw");
  await expect(address).toContainText("Poland");
  await expect(adminPage.getByText("Standard delivery")).toBeVisible();
  await expectNoA11yViolations(adminPage);
});

test("an order made before delivery existed says no address was recorded", async ({
  page,
  browser,
  request,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  const order = await seedPendingOrder(await cartIdOf(page), socks, {
    quantity: 1,
    priceCents: 1250,
  });
  expect((await postPaidEvent(request, order)).status()).toBe(200);

  await page.goto(`/checkout/complete?session_id=${order.sessionId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Thank you for your order" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivering to" })).toHaveCount(0);

  const admin = await createTestUser({ enrolled: true });
  const adminPage = await (await browser.newContext()).newPage();
  await signInFully(adminPage, admin);
  await adminPage.goto("/admin/orders");
  await expect(adminPage.getByRole("row", { name: new RegExp(`#${order.number}`) })).toContainText(
    "Not recorded",
  );
  await adminPage.goto(`/admin/orders/${order.number}`);
  await expect(adminPage.getByText("No address recorded")).toBeVisible();
});
