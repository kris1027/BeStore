import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { createTestUser, signInFully } from "../admin/support";

// Spec 0005, AC-5 and AC-6: one optional image, uploaded straight to Storage, with alt text.

const fixture = path.resolve("tests/e2e/fixtures/product.png");

test("an admin uploads a product image that the storefront shows with its alt text", async ({
  page,
  browser,
}) => {
  const name = `Stoneware mug ${randomUUID().slice(0, 8)}`;
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto("/admin/products/new");

  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Price for the product").fill("24");
  await page.getByLabel("Stock for the product").fill("7");
  await page.getByLabel("Photo").setInputFiles(fixture);
  await expect(page.getByLabel("Alt text")).toBeVisible();

  // Alt text is required once an image is attached.
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Describe the image for people who cannot see it.")).toBeVisible();
  await expect(page.getByLabel("Alt text")).toBeFocused();

  await page.getByLabel("Alt text").fill("A sand colored mug on a wooden table");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page).toHaveURL("/admin/products");

  const customer = await (await browser.newContext()).newPage();
  await customer.goto("/");
  const card = customer.getByRole("link", { name: new RegExp(name) });
  const cardImage = card.getByRole("img", { name: "A sand colored mug on a wooden table" });
  await expect(cardImage).toBeVisible();
  await expect(cardImage).toHaveAttribute("src", /product-images%2Fproducts%2F[0-9a-f-]+\.png/);
  // The optimizer really fetched it from Storage.
  await expect
    .poll(() => cardImage.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await card.click();
  await expect(customer.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(
    customer.getByRole("img", { name: "A sand colored mug on a wooden table" }),
  ).toBeVisible();
});

test("a file that is not an image is refused before any upload", async ({ page }) => {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto("/admin/products/new");

  await page.getByLabel("Photo").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByText("Choose a PNG, JPEG, WebP or AVIF file.")).toBeVisible();
});
