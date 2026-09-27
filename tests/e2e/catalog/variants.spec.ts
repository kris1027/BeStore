import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { createTestUser, signInFully } from "../admin/support";

// Spec 0005, milestone 2: options generate the variant grid, and the product page picks one.

async function signInAsAdmin(page: Page) {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto("/admin/products/new");
}

async function addOption(page: Page, index: number, name: string, values: readonly string[]) {
  await page.getByRole("button", { name: "Add option" }).click();
  await page.getByLabel("Option name").nth(index).fill(name);
  for (const [v, value] of values.entries()) {
    if (v > 0) await page.getByRole("button", { name: `Add value to ${name}` }).click();
    await page.getByLabel(`${name} value ${v + 1}`, { exact: true }).fill(value);
  }
}

test("options build a variant grid that keeps typed rows, and the picker follows stock", async ({
  page,
}) => {
  const name = `Merino crew ${randomUUID().slice(0, 8)}`;
  await signInAsAdmin(page);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await addOption(page, 0, "Size", ["S", "M"]);
  await addOption(page, 1, "Color", ["Navy"]);

  await page.getByLabel("Price for S / Navy").fill("49");
  await page.getByLabel("Stock for S / Navy").fill("0");
  await page.getByLabel("Price for M / Navy").fill("55");
  await page.getByLabel("Stock for M / Navy").fill("12");
  await expect(page.getByLabel("SKU for M / Navy")).toHaveValue(/-M-NAVY$/);

  // A new value adds only its own rows; the rows already typed keep their values (AC-2).
  await page.getByRole("button", { name: "Add value to Color" }).click();
  await page.getByLabel("Color value 2", { exact: true }).fill("Oat");
  await expect(page.getByLabel(/^Price for/)).toHaveCount(4);
  await expect(page.getByLabel("Price for M / Navy")).toHaveValue("55");
  await page.getByLabel("Price for S / Oat").fill("49");
  await page.getByLabel("Stock for S / Oat").fill("0");
  await page.getByLabel("Price for M / Oat").fill("55.5");
  await page.getByLabel("Stock for M / Oat").fill("3");

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page).toHaveURL("/admin/products");
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("€49.00 to €55.50");

  await page.goto(`/products/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  // Every S is sold out, so S stays visible but disabled, and says so in text (AC-7).
  await expect(page.getByRole("radio", { name: "S (sold out)" })).toBeDisabled();
  // The first in stock variant by position is picked: M / Navy.
  await expect(page.getByRole("radio", { name: "M", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Navy" })).toBeChecked();
  await expect(page.getByText("€55.00")).toBeVisible();
  await expect(page.getByText("In stock")).toBeVisible();

  await page.getByRole("radio", { name: "Oat" }).check();
  await expect(page.getByText("€55.50")).toBeVisible();
  await expect(page.getByText("Only 3 left")).toBeVisible();

  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to cart")).toBeVisible();
  await page.goto("/cart");
  await expect(page.getByText("M / Oat", { exact: true })).toBeVisible();
});

test("the form shows each refusal on its field", async ({ page }) => {
  await signInAsAdmin(page);
  await page.getByLabel("Name", { exact: true }).fill("Bad input");
  await page.getByLabel("URL name").fill("Bad Slug");
  await page.getByLabel("Price for the product").fill("1.999");
  await page.getByLabel("Stock for the product").fill("-2");
  await page.getByRole("button", { name: "Save as draft" }).click();

  await expect(
    page.getByText("Use lowercase letters and digits, joined by single hyphens."),
  ).toBeVisible();
  await expect(page.getByText("This currency does not have that many decimals.")).toBeVisible();
  await expect(page.getByText("Enter a whole number.")).toBeVisible();
  await expect(page.getByLabel("URL name")).toBeFocused();

  // Checks across fields (duplicates) run once each field on its own is valid.
  await page.getByLabel("URL name").fill("bad-input");
  await addOption(page, 0, "Size", ["S", "s"]);
  for (const value of ["S", "s"]) {
    await page.getByLabel(`Price for ${value}`, { exact: true }).fill("5");
  }
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("This value is already there.")).toBeVisible();
  await expect(page.getByText("Another variant uses this SKU.")).toBeVisible();
  await expect(page).toHaveURL("/admin/products/new");
});

test("a URL name another product uses is refused by the server", async ({ page }) => {
  await signInAsAdmin(page);
  const name = `Twin ${randomUUID().slice(0, 8)}`;
  for (const attempt of [1, 2]) {
    if (attempt === 2) await page.goto("/admin/products/new");
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Price for the product").fill("5");
    await page
      .getByLabel("SKU for the product")
      .fill(`TWIN-${attempt}-${randomUUID().slice(0, 6)}`);
    await page.getByRole("button", { name: "Save as draft" }).click();
    if (attempt === 1) await expect(page).toHaveURL("/admin/products");
  }
  await expect(page.getByText("Another product already uses this URL name.")).toBeVisible();
  await expect(page.getByLabel("URL name")).toBeFocused();
});
