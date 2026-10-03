import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { createTestUser, signInFully } from "../admin/support";
import { seedProduct, waitForEditor } from "./support";

// spec 0009, milestone 1: one edit from the admin editor to the storefront, and the status
// buttons that take a product off the storefront and put it back first in line.

async function signInAsAdmin(page: Page) {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
}

async function openEditor(page: Page, product: { readonly id: string; readonly name: string }) {
  // Searched, so a page of newer products from tests running alongside never hides it.
  await page.goto(`/admin/products?q=${encodeURIComponent(product.name)}`);
  await page.getByRole("link", { name: product.name }).click();
  await expect(page).toHaveURL(`/admin/products/${product.id}`);
  await waitForEditor(page, product.name);
}

test("an admin renames a live product and the storefront follows on its next request", async ({
  page,
  browser,
}) => {
  const product = await seedProduct({ stock: 4, label: "Canvas tote" });
  await signInAsAdmin(page);
  await openEditor(page, product);

  const renamed = `${product.name} renamed`;
  await page.getByLabel("Name", { exact: true }).fill(renamed);
  await page.getByLabel("URL name").fill(`${product.slug}-renamed`);
  // A live product warns that its old address stops working (AC-5).
  await expect(page.getByText(`Links to /products/${product.slug} stop working`)).toBeVisible();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Details saved")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(`/products/${product.slug}-renamed`);
  await expect(customer.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
  await customer.goto(`/products/${product.slug}`);
  await expect(customer.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
});

test("a second editor's Details save is refused instead of overwriting the first", async ({
  page,
  browser,
}) => {
  const product = await seedProduct({ stock: 1, label: "Clay bowl" });
  await signInAsAdmin(page);
  await openEditor(page, product);

  const other = await (await browser.newContext()).newPage();
  await signInAsAdmin(other);
  await openEditor(other, product);
  await other.getByLabel("Name", { exact: true }).fill(`${product.name} first`);
  await other.getByRole("button", { name: "Save details" }).click();
  await expect(other.getByText("Details saved")).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill(`${product.name} second`);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(
    page.getByText("This product changed since you opened it. Reload to see the latest."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`${product.name} first`);
});

test("hiding takes a product off the storefront and publishing puts it back first", async ({
  page,
  browser,
}) => {
  const product = await seedProduct({ stock: 2, label: "Oak spoon" });
  // Another live product, so "first" means something.
  await seedProduct({ stock: 2, label: "Birch spoon" });
  await signInAsAdmin(page);
  await openEditor(page, product);

  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByText("Product hidden")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await customer.goto("/");
  await expect(customer.getByRole("link", { name: new RegExp(product.name) })).toHaveCount(0);
  await customer.goto(`/products/${product.slug}`);
  await expect(customer.getByRole("heading", { name: "We can't find that page" })).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Product published")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide" })).toBeVisible();

  await customer.goto("/");
  const firstCard = customer.getByRole("region", { name: "Shop all" }).getByRole("link").first();
  await expect(firstCard).toContainText(product.name);
  await customer.goto(`/products/${product.slug}`);
  await expect(customer.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
});

test("archive and restore never put a product straight back live", async ({ page }) => {
  const product = await seedProduct({ stock: 2, label: "Linen apron" });
  await signInAsAdmin(page);
  await openEditor(page, product);

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Product archived")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("Product restored as a draft")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();

  await page.goto("/admin/products?status=draft");
  await expect(page.getByRole("link", { name: "Draft", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: product.name })).toBeVisible();
});

test("the edit page has no axe violations and an unknown id shows the not found state", async ({
  page,
}) => {
  const product = await seedProduct({ stock: 2, label: "Wax candle" });
  await signInAsAdmin(page);
  await page.goto(`/admin/products/${product.id}`);
  await waitForEditor(page, product.name);
  await expectNoA11yViolations(page);

  await page.getByLabel("Weight in grams").fill("0");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText(/Enter whole grams from 1 to 100000/)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/admin/products/not-a-product");
  await expect(page.getByRole("heading", { level: 1, name: "Product not found" })).toBeVisible();
  await expectNoA11yViolations(page);
});
