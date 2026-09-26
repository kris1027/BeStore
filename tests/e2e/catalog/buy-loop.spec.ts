import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { brand } from "../../../src/lib/brand/brand";
import { createTestUser, signInFully } from "../admin/support";

// Spec 0005, milestone 1: one real product from the admin form to a cart that survives reload.

type NewProduct = { readonly name: string; readonly price: string; readonly stock: string };

async function createProductAsAdmin(
  page: Page,
  product: NewProduct,
  button: "Publish" | "Save as draft",
) {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);

  await page.goto("/admin/products");
  await page.getByRole("link", { name: "New product" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "New product" })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill(product.name);
  await page.getByLabel("Description").fill("Soft, simple and made to last.");
  await page.getByLabel("Price for the product").fill(product.price);
  await page.getByLabel("Stock for the product").fill(product.stock);
  await page.getByRole("button", { name: button }).click();

  await expect(page).toHaveURL("/admin/products");
  await expect(
    page.getByText(button === "Publish" ? "Product published" : "Draft saved"),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: new RegExp(product.name) })).toBeVisible();
}

function uniqueName(label: string) {
  return `${label} ${randomUUID().slice(0, 8)}`;
}

function slugOf(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

test("an admin publishes a product and a customer keeps it in the cart across a reload", async ({
  page,
  browser,
}) => {
  const name = uniqueName("Linen shirt");
  await createProductAsAdmin(page, { name, price: "19.99", stock: "3" }, "Publish");

  // A separate browser, so the customer shares nothing with the admin.
  const customer = await (await browser.newContext()).newPage();
  const home = await customer.goto("/");
  expect(home?.status()).toBe(200);
  await expect(customer.getByRole("heading", { level: 1, name: brand.name })).toBeVisible();
  await customer.getByRole("link", { name: new RegExp(name) }).click();

  await expect(customer).toHaveURL(`/products/${slugOf(name)}`);
  await expect(customer.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(customer.getByText("Only 3 left")).toBeVisible();

  await customer.getByLabel("Quantity").fill("2");
  await customer.getByRole("button", { name: "Add to cart" }).click();
  await expect(customer.getByText("Added to cart")).toBeVisible();

  const cookie = (await customer.context().cookies()).find((c) => c.name === "bestore_cart");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");

  await customer.getByRole("button", { name: "View cart" }).click();
  await expect(customer).toHaveURL("/cart");
  await expect(customer.getByRole("link", { name })).toBeVisible();
  const quantity = customer.getByRole("group", { name: `Quantity of ${name}` }).locator("output");
  await expect(quantity).toHaveText("2");
  await expect(customer.getByRole("link", { name: "Cart, 2 items" })).toBeVisible();

  await customer.reload();
  await expect(quantity).toHaveText("2");

  // Asking for more than the stock caps the line at what is left (AC-8).
  await customer.goto(`/products/${slugOf(name)}`);
  await customer.getByLabel("Quantity").fill("3");
  await customer.getByRole("button", { name: "Add to cart" }).click();
  await expect(customer.getByText("Only 3 available")).toBeVisible();
  await customer.goto("/cart");
  await expect(quantity).toHaveText("3");
});

test("a draft stays off the storefront", async ({ page, browser }) => {
  const name = uniqueName("Draft scarf");
  await createProductAsAdmin(page, { name, price: "12", stock: "5" }, "Save as draft");

  const customer = await (await browser.newContext()).newPage();
  await customer.goto("/");
  await expect(customer.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);

  await customer.goto(`/products/${slugOf(name)}`);
  await expect(customer.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
});

test("an empty cart says so and links back to the shop", async ({ page }) => {
  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  await page.getByRole("link", { name: "Continue shopping" }).click();
  await expect(page).toHaveURL("/");
});
