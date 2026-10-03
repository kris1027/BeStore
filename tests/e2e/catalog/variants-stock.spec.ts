import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { createTestUser, signInFully } from "../admin/support";
import {
  seedProduct,
  seedProductWithOptions,
  setStock,
  type SeededProduct,
  waitForEditor,
} from "./support";

// spec 0009, milestone 2: stock set by count with its history, compare at prices on the
// storefront, and a new option value from the editor.

async function openEditor(page: Page, product: SeededProduct) {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto(`/admin/products/${product.id}`);
  await waitForEditor(page, product.name);
  return admin;
}

test("an admin sets stock with a note and sees it in the history", async ({ page }) => {
  const product = await seedProduct({ stock: 4, label: "Felt slippers" });
  const admin = await openEditor(page, product);

  await page.getByLabel("New count for Default").fill("12");
  await page.getByLabel("Note for Default").fill("Delivery from the workshop");
  await page.getByRole("button", { name: "Save stock" }).click();
  await expect(page.getByText("Stock saved")).toBeVisible();

  const history = page.getByRole("region", { name: "Stock history" });
  const row = history.getByRole("row").filter({ hasText: "Adjustment" });
  await expect(row).toContainText("+8");
  await expect(row).toContainText("12");
  await expect(row).toContainText(admin.name);
  await expect(row).toContainText("Delivery from the workshop");
});

test("a stock save is refused when a sale moved the count, then saves against the new one", async ({
  page,
}) => {
  const product = await seedProduct({ stock: 6, label: "Wool scarf" });
  await openEditor(page, product);

  // A sale lands while the admin types.
  await setStock(product.variantId, 5);
  await page.getByLabel("New count for Default").fill("9");
  await page.getByRole("button", { name: "Save stock" }).click();
  await expect(page.getByText("Stock is now 5. Check it and save again.")).toBeVisible();
  await expect(page.getByLabel("New count for Default")).toBeFocused();

  await page.getByRole("button", { name: "Save stock" }).click();
  await expect(page.getByText("Stock saved")).toBeVisible();
  const history = page.getByRole("region", { name: "Stock history" });
  await expect(history.getByRole("row").filter({ hasText: "Adjustment" })).toContainText("+4");
});

test("a compare at price shows as a sale on the card and the product page", async ({
  page,
  browser,
}) => {
  const product = await seedProduct({ stock: 3, priceCents: 2000, label: "Linen napkins" });
  await openEditor(page, product);

  await page.getByLabel("Compare at price for Default").fill("20");
  await page.getByRole("button", { name: "Save variants" }).click();
  await expect(page.getByText("Enter a price above the selling price.")).toBeVisible();

  await page.getByLabel("Compare at price for Default").fill("28");
  await page.getByRole("button", { name: "Save variants" }).click();
  await expect(page.getByText("Variants saved")).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(`/products/${product.slug}`);
  const struck = customer.locator("s");
  await expect(struck).toHaveText("Was €28.00");
  await expect(customer.getByText("€20.00", { exact: true })).toBeVisible();

  await customer.goto("/");
  const card = customer.getByRole("link", { name: new RegExp(product.name) });
  await expect(card.getByText("Sale", { exact: true })).toBeVisible();
});

test("an admin adds a Size value and the storefront offers it", async ({ page, browser }) => {
  const product = await seedProductWithOptions();
  await openEditor(page, product);

  await page.getByRole("button", { name: "Add value to Size" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a value to Size" });
  await dialog.getByLabel("New Size value").fill("L");
  await expect(dialog.getByLabel("SKU for L", { exact: true })).toHaveValue(
    `${product.slug}-L`.toUpperCase(),
  );
  await dialog.getByLabel("Price for L", { exact: true }).fill("22");
  await dialog.getByLabel("Stock for L", { exact: true }).fill("5");
  await dialog.getByRole("button", { name: "Add value" }).click();
  await expect(page.getByText("Size value added")).toBeVisible();

  await expect(page.getByLabel("Price for L", { exact: true })).toHaveValue("22.00");
  await expect(page.getByLabel("New count for L")).toHaveValue("5");
  const history = page.getByRole("region", { name: "Stock history" });
  await expect(history.getByRole("row").filter({ hasText: "Opening count" }).first()).toContainText(
    "L",
  );

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(`/products/${product.slug}`);
  await customer.getByRole("radio", { name: "L", exact: true }).check();
  await expect(customer.getByText("€22.00")).toBeVisible();
});

test("the last variant of a live product cannot be archived", async ({ page }) => {
  const product = await seedProduct({ stock: 3, label: "Cork board" });
  await openEditor(page, product);

  await page.getByRole("button", { name: "Archive Default" }).click();
  await page.getByRole("button", { name: "Save variants" }).click();
  await expect(
    page.getByText(
      "Hide or archive the product instead. A live product needs at least one variant.",
    ),
  ).toBeVisible();
});

test("the Variants and Stock sections have no axe violations, dialog included", async ({
  page,
}) => {
  const product = await seedProductWithOptions();
  await openEditor(page, product);
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Add value to Size" }).click();
  await expect(page.getByRole("dialog", { name: "Add a value to Size" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Add value to Size" })).toBeFocused();
});
