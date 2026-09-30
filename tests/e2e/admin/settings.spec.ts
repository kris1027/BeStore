import { type Browser, expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { seedProduct } from "../catalog/support";
import { addToCart, fillCheckout, hasRealStripeKey } from "../checkout/support";
import { createTestUser, injectSession, signInFully } from "./support";

// spec 0007, AC-4, AC-7, AC-8, AC-10 and AC-16: the admin sets the delivery fee and the free
// delivery threshold, and the cart and checkout follow on their next load. store_settings is one
// row every spec shares, so these run on one project, one at a time, and put the row back after.
// Every change goes through the form: only the action expires the cached store-settings read, so
// a change written straight to the database would not reach the cart.

test.describe.configure({ mode: "serial" });

let adminPage: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  adminPage = await signedInAdmin(browser);
});

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "changes the shared store_settings row");
});

test.afterEach(async ({}, testInfo) => {
  if (testInfo.project.name !== "desktop") return;
  await saveSettings(adminPage, "0", null);
});

async function signedInAdmin(browser: Browser): Promise<Page> {
  const admin = await createTestUser({ enrolled: true });
  const page = await (await browser.newContext()).newPage();
  await signInFully(page, admin);
  return page;
}

function freeDeliveryBox(page: Page) {
  return page.getByRole("checkbox", { name: "Offer free delivery" });
}

// Save is enabled once the form has hydrated and filled in the current values.
async function openSettings(page: Page) {
  await page.goto("/admin/settings");
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
}

async function saveSettings(page: Page, fee: string, threshold: string | null) {
  await openSettings(page);
  await page.getByLabel("Delivery fee").fill(fee);
  if (threshold === null) {
    await freeDeliveryBox(page).uncheck();
  } else {
    await freeDeliveryBox(page).check();
    await page.getByLabel("Free delivery from").fill(threshold);
  }
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Shipping settings saved.")).toBeVisible();
}

test("an admin sets the fee and threshold, and the cart and checkout show them", async ({
  page,
}) => {
  await adminPage.goto("/admin");
  await adminPage.getByRole("link", { name: "Settings" }).click();
  await expect(adminPage.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(adminPage.getByRole("button", { name: "Save" })).toBeEnabled();
  await expect(adminPage.getByLabel("Delivery fee")).toHaveValue("0.00");
  await expect(adminPage.getByLabel("Free delivery from")).toBeDisabled();
  await expectNoA11yViolations(adminPage);

  await saveSettings(adminPage, "9.99", "50");
  await expectNoA11yViolations(adminPage);

  await adminPage.reload();
  await expect(adminPage.getByLabel("Delivery fee")).toHaveValue("9.99");
  await expect(adminPage.getByLabel("Free delivery from")).toHaveValue("50.00");

  // Below the threshold: the fee, the total with it, and how much more makes it free.
  const socks = await seedProduct({ stock: 9, priceCents: 1250 });
  await addToCart(page, socks, 2);
  await page.goto("/cart");
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary).toContainText("Standard delivery");
  await expect(summary).toContainText("€9.99");
  await expect(summary).toContainText("€34.99");
  await expect(summary).toContainText("Add €25.00 more for free delivery");
  await expectNoA11yViolations(page);

  await page.goto("/checkout");
  await expect(page.getByRole("button", { name: "Pay €34.99" })).toBeVisible();
  await expectNoA11yViolations(page);

  // At the threshold: free, and no nudge.
  await addToCart(page, socks, 2);
  await page.goto("/cart");
  await expect(summary).toContainText("Free delivery");
  await expect(summary).toContainText("€50.00");
  await expect(summary).not.toContainText("more for free delivery");
  await page.goto("/checkout");
  await expect(page.getByRole("button", { name: "Pay €50.00" })).toBeVisible();
});

test("Pay charges the fee in effect at Pay, even after the page loaded with another", async ({
  page,
}) => {
  test.skip(!hasRealStripeKey, "needs a real Stripe test key (STRIPE_SECRET_KEY)");
  await saveSettings(adminPage, "5", null);
  const socks = await seedProduct({ stock: 9, priceCents: 1250 });
  await addToCart(page, socks);
  await page.goto("/checkout");
  await expect(page.getByRole("button", { name: "Pay €17.50" })).toBeVisible();

  await saveSettings(adminPage, "9", null);
  await fillCheckout(page);
  await page.getByRole("button", { name: "Pay €17.50" }).click();

  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });
  await expect(page.getByText("€21.50").first()).toBeVisible({ timeout: 20_000 });
});

test("bad amounts show their messages on the field", async () => {
  await openSettings(adminPage);

  await adminPage.getByLabel("Delivery fee").fill("9,99");
  await freeDeliveryBox(adminPage).check();
  await adminPage.getByLabel("Free delivery from").fill("0");
  await adminPage.getByRole("button", { name: "Save" }).click();

  await expect(adminPage.getByText("Enter an amount like 9.99.")).toBeVisible();
  await expect(adminPage.getByText("Enter an amount above 0.")).toBeVisible();
  await expect(adminPage.getByLabel("Delivery fee")).toBeFocused();
  await expect(adminPage.getByLabel("Delivery fee")).toHaveAttribute("aria-invalid", "true");
  await expectNoA11yViolations(adminPage);

  await adminPage.getByLabel("Delivery fee").fill("1000.01");
  await freeDeliveryBox(adminPage).uncheck();
  await adminPage.getByRole("button", { name: "Save" }).click();
  await expect(adminPage.getByText("Delivery fee can be at most 1,000.00.")).toBeVisible();
  await expect(adminPage.getByText("Enter an amount above 0.")).toHaveCount(0);
});

test("the settings form works by keyboard alone", async () => {
  await openSettings(adminPage);

  const fee = adminPage.getByLabel("Delivery fee");
  await tabTo(adminPage, fee);
  await adminPage.keyboard.press("ControlOrMeta+A");
  await adminPage.keyboard.type("4.50");
  await adminPage.keyboard.press("Tab");
  await expect(freeDeliveryBox(adminPage)).toBeFocused();
  await adminPage.keyboard.press("Space");
  await adminPage.keyboard.press("Tab");
  await expect(adminPage.getByLabel("Free delivery from")).toBeFocused();
  await adminPage.keyboard.type("80");
  await adminPage.keyboard.press("Enter");

  await expect(adminPage.getByText("Shipping settings saved.")).toBeVisible();
});

test("the settings page sends a signed out visitor to sign in and 404s for a non admin", async ({
  page,
}) => {
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/admin\/sign-in\?next=%2Fadmin%2Fsettings/);

  const customer = await createTestUser({ admin: false });
  await injectSession(page, customer);
  const response = await page.goto("/admin/settings");
  expect(response?.status()).toBe(404);
});
