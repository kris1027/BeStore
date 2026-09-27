import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { createTestUser, signInFully } from "../admin/support";
import { seedProduct, seedProductWithOptions, setStock } from "./support";

// Spec 0005, AC-17: axe on every page of the buy loop, in its states, on desktop and phone
// (both Playwright projects), plus the flows by keyboard alone.

async function addByKeyboard(page: Page) {
  await page.getByRole("button", { name: "Add to cart" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Added to cart")).toBeVisible();
}

test("the storefront pages have no axe violations", async ({ page }) => {
  const simple = await seedProduct({ stock: 3 });
  const withOptions = await seedProductWithOptions();

  await page.goto("/");
  await expectNoA11yViolations(page);

  await page.goto(`/products/${simple.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: simple.name })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto(`/products/${withOptions.slug}`);
  await expect(page.getByRole("radio", { name: "S (sold out)" })).toBeDisabled();
  await expectNoA11yViolations(page);

  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto(`/products/${simple.slug}`);
  await addByKeyboard(page);
  await page.goto("/cart");
  await expect(page.getByRole("link", { name: "Checkout" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/checkout");
  await expect(page.getByText("Payment comes next")).toBeVisible();
  await expectNoA11yViolations(page);

  await setStock(simple.variantId, 0);
  await page.goto("/cart");
  await expect(page.getByText("Sold out")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("a customer picks, adds and changes the cart by keyboard alone", async ({ page }) => {
  const product = await seedProductWithOptions();
  await page.goto(`/products/${product.slug}`);

  // The picker starts on the in stock size; arrow keys move within the group.
  const medium = page.getByRole("radio", { name: "M", exact: true });
  await expect(medium).toBeChecked();
  await medium.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Quantity")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Added to cart")).toBeVisible();

  await page.goto("/cart");
  const label = `${product.name}, M`;
  await page.getByRole("button", { name: `Increase quantity of ${label}` }).focus();
  await page.keyboard.press("Enter");
  // The quantity is a live region, so the change is announced.
  const quantity = page.getByRole("group", { name: `Quantity of ${label}` }).locator("output");
  await expect(quantity).toHaveAttribute("aria-live", "polite");
  await expect(quantity).toHaveText("3");

  await page.getByRole("button", { name: `Remove ${label}` }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
});

test("the admin product pages have no axe violations, errors included", async ({ page }) => {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);

  await page.goto("/admin/products");
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/admin/products/new");
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Add option" }).click();
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("Enter a name.")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("an admin creates a product by keyboard alone", async ({ page }) => {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto("/admin/products/new");
  const name = `Keyboard tote ${Date.now()}`;

  await page.getByLabel("Name", { exact: true }).focus();
  await page.keyboard.type(name);
  await page.getByLabel("Price for the product").focus();
  await page.keyboard.type("18");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("4");
  await page.getByRole("button", { name: "Publish" }).focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/admin/products");
  await expect(page.getByRole("cell", { name: new RegExp(name) })).toBeVisible();
});
