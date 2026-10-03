import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { createTestUser, signInFully, withDb } from "../admin/support";
import { seedProduct, setProductStatus, waitForEditor } from "./support";

// spec 0009, milestone 4: categories from both sides, arranging by keyboard, the filtered and
// paged product list, and delete.

async function signIn(page: Page) {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
}

test("an admin creates a category, adds a product from both sides and deletes it", async ({
  page,
}) => {
  const product = await seedProduct({ stock: 2, label: "Linen sheet" });
  const other = await seedProduct({ stock: 2, label: "Linen pillow" });
  const name = `Bedroom ${randomUUID().slice(0, 6)}`;
  await signIn(page);

  await page.goto("/admin/categories");
  await page.getByRole("link", { name: "New category" }).first().click();
  await expect(page.getByRole("button", { name: "Add category" })).toBeEnabled();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await expect(page.getByLabel("URL name")).toHaveValue(name.toLowerCase().replace(/ /g, "-"));
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // From the category: search, then add.
  await page.getByLabel("Add products").fill(product.name);
  await page.getByRole("button", { name: "Find" }).click();
  await page.getByRole("button", { name: `Add ${product.name}` }).click();
  await expect(
    page
      .getByRole("list", { name: "Products in this category" })
      .getByRole("link", { name: product.name }),
  ).toBeVisible();

  // From the product: tick the category.
  await page.goto(`/admin/products/${other.id}`);
  await waitForEditor(page, other.name);
  await page.getByRole("checkbox", { name }).check();
  await page.getByRole("button", { name: "Save categories" }).click();
  await expect(page.getByText("Categories saved")).toBeVisible();

  await page.goto("/admin/categories");
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toContainText("2 products");
  await row.getByRole("link", { name }).click();

  await page.getByRole("button", { name: "Delete category" }).click();
  const dialog = page.getByRole("dialog", { name: `Delete ${name}?` });
  await expect(dialog).toContainText("It holds 2 products");
  await dialog.getByRole("button", { name: "Delete category" }).click();
  await expect(page).toHaveURL("/admin/categories");
  await expect(page.getByRole("link", { name })).toHaveCount(0);

  await page.goto(`/admin/products/${product.id}`);
  await waitForEditor(page, product.name);
});

// Moves one product up a place by keyboard and saves. Other tests publish and hide products in
// parallel, which rightly refuses a save over a changed list, so a refusal reloads and retries.
async function moveUpByKeyboard(page: Page, name: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.goto("/admin/products/arrange");
    await expect(page.getByRole("heading", { level: 1, name: "Arrange products" })).toBeVisible();
    await page.getByRole("button", { name: `Move ${name}` }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("status").filter({ hasText: `Picked up ${name}` })).toBeAttached();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("status").filter({ hasText: `${name} moved to` })).toBeAttached();
    await page.keyboard.press("Space");
    const outcome = page.getByText(/Order saved\.|The list changed/);
    await expect(outcome).toBeVisible();
    if ((await outcome.textContent())?.startsWith("Order saved")) return;
  }
  throw new Error("The arrange save kept being refused");
}

test("products are arranged by keyboard and the home grid follows", async ({
  page,
  browser,
}, testInfo) => {
  // One project only: a second run in parallel would save its own full order over this one.
  test.skip(testInfo.project.name !== "desktop", "Arranging is global; it runs once.");
  const first = await seedProduct({ stock: 2, label: "Arrange first" });
  const second = await seedProduct({ stock: 2, label: "Arrange second" });
  // Both far ahead of everything else, second just ahead of first.
  const base = -1_000_000_000 + Math.floor(Math.random() * 1_000_000) * 2;
  await withDb((db) =>
    db.query(
      "UPDATE products SET position = CASE id WHEN $1 THEN $3::int + 1 ELSE $3::int END WHERE id IN ($1, $2)",
      [first.id, second.id, base],
    ),
  );
  await signIn(page);

  await moveUpByKeyboard(page, first.name);
  const names = await page
    .getByRole("list", { name: "Active products, in home page order" })
    .getByRole("listitem")
    .allTextContents();
  const at = (name: string) => names.findIndex((text) => text.includes(name));
  expect(at(first.name)).toBeLessThan(at(second.name));

  const customer = await (await browser.newContext()).newPage();
  await customer.goto("/");
  const cards = await customer
    .getByRole("region", { name: "Shop all" })
    .getByRole("link")
    .allTextContents();
  const card = (name: string) => cards.findIndex((text) => text.includes(name));
  expect(card(first.name)).toBeGreaterThanOrEqual(0);
  expect(card(first.name)).toBeLessThan(card(second.name));
});

test("a stale arrange is refused with a reload", async ({ page }) => {
  await seedProduct({ stock: 2, label: "Stale one" });
  const later = await seedProduct({ stock: 2, label: "Stale two" });
  await signIn(page);
  await page.goto("/admin/products/arrange");
  await expect(page.getByRole("heading", { level: 1, name: "Arrange products" })).toBeVisible();

  // Someone hides a product meanwhile.
  await setProductStatus(later.id, "draft");
  const handle = page.getByRole("button", { name: /^Move / }).nth(1);
  await handle.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("status").filter({ hasText: "moved to position 1" })).toBeAttached();
  await page.keyboard.press("Space");
  await expect(page.getByText("The list changed. Reload to see the latest.")).toBeVisible();
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("button", { name: `Move ${later.name}` })).toHaveCount(0);
});

test("the list searches by SKU, filters by category and status, and keeps it in the URL", async ({
  page,
}) => {
  const product = await seedProduct({ stock: 2, label: "Searchable bowl" });
  const sku = await withDb(async (db) => {
    const result = await db.query<{ sku: string }>(
      "SELECT sku FROM product_variants WHERE id = $1",
      [product.variantId],
    );
    return result.rows[0]!.sku;
  });
  await signIn(page);

  await page.goto("/admin/products");
  await page.getByLabel("Name or SKU").fill(sku.toLowerCase());
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(new RegExp(`q=${sku.toLowerCase()}`));
  await expect(page.getByRole("link", { name: product.name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: product.name })).toBeVisible();

  await page.getByRole("link", { name: "Archived", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`status=archived.*q=`));
  await expect(page.getByRole("heading", { name: /No Archived products, matching/ })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL("/admin/products");
  await expectNoA11yViolations(page);
});

test("a draft never ordered is deleted after confirming", async ({ page }) => {
  const product = await seedProduct({ stock: 2, label: "Delete me" });
  await setProductStatus(product.id, "draft");
  await signIn(page);
  await page.goto(`/admin/products/${product.id}`);
  await waitForEditor(page, product.name);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Delete ${product.name}?` });
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Delete product" }).click();
  await expect(page).toHaveURL("/admin/products");
  await expect(page.getByText("Product deleted")).toBeVisible();
  await page.goto(`/admin/products/${product.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Product not found" })).toBeVisible();
});

test("a live product offers no Delete", async ({ page }) => {
  const product = await seedProduct({ stock: 2, label: "Keep me" });
  await signIn(page);
  await page.goto(`/admin/products/${product.id}`);
  await waitForEditor(page, product.name);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
});

test("the category and arrange pages have no axe violations", async ({ page }) => {
  await seedProduct({ stock: 2, label: "Axe arrange" });
  await signIn(page);
  await page.goto("/admin/products/arrange");
  await expect(page.getByRole("heading", { level: 1, name: "Arrange products" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto("/admin/categories/new");
  await expect(page.getByRole("heading", { level: 1, name: "New category" })).toBeVisible();
  // Enabled on hydration; axe would otherwise measure the button mid fade.
  await expect(page.getByRole("button", { name: "Add category" })).toBeEnabled();
  await expectNoA11yViolations(page);
  await page.goto("/admin/categories/not-a-category");
  await expect(page.getByRole("heading", { level: 1, name: "Category not found" })).toBeVisible();
  await page.goto("/admin/categories");
  await expect(page.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible();
  await expectNoA11yViolations(page);
});
