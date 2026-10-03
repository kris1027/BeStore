import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { createTestUser, signInFully } from "../admin/support";
import { seedProduct, seedProductWithOptions, type SeededProduct, waitForEditor } from "./support";

// spec 0009, milestone 3: several images per product, ordered by keyboard, tied to an option
// value, the gallery that follows the picker, and the Markdown description.

const fixture = path.resolve("tests/e2e/fixtures/product.png");

async function openEditor(page: Page, product: SeededProduct) {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto(`/admin/products/${product.id}`);
  await waitForEditor(page, product.name);
}

async function upload(page: Page, index: number, altText: string) {
  await page.getByLabel("Add an image").setInputFiles(fixture);
  await expect(page.getByLabel(`Alt text for image ${index}`)).toBeVisible();
  await page.getByLabel(`Alt text for image ${index}`).fill(altText);
}

test("images are reordered by keyboard alone and the first becomes the card image", async ({
  page,
  browser,
}) => {
  const product = await seedProduct({ stock: 3, label: "Clay vase" });
  await openEditor(page, product);

  await upload(page, 1, "Vase from the front");
  await upload(page, 2, "Vase from above");
  await page.getByRole("button", { name: "Save images" }).click();
  await expect(page.getByText("Images saved")).toBeVisible();

  // A fresh load, so the section is not remounted under the keyboard by the save's refresh.
  await page.reload();
  await waitForEditor(page, product.name);
  const handle = page.getByRole("button", { name: "Move image Vase from above" });
  // Both images in view: dnd-kit scrolls first, instead of moving, toward an item out of view.
  await page.getByRole("list", { name: "Images, in display order" }).scrollIntoViewIfNeeded();
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status").filter({ hasText: "Picked up" })).toHaveText(
    "Picked up image Vase from above. Position 2 of 2.",
  );
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("status").filter({ hasText: "moved" })).toHaveText(
    "image Vase from above moved to position 1 of 2.",
  );
  await page.keyboard.press("Space");
  await expect(page.getByRole("status").filter({ hasText: "dropped" })).toHaveText(
    "image Vase from above dropped at position 1 of 2.",
  );
  await expect(page.getByLabel("Alt text for image 1")).toHaveValue("Vase from above");
  await page.getByRole("button", { name: "Save images" }).click();
  await expect(page.getByText("Images saved")).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await customer.goto("/");
  const card = customer.getByRole("link", { name: new RegExp(product.name) });
  await expect(card.getByRole("img", { name: "Vase from above" })).toBeVisible();
});

test("an image tied to a value shows only when that value is picked", async ({ page, browser }) => {
  const product = await seedProductWithOptions();
  await openEditor(page, product);

  await upload(page, 1, "Beanie on a shelf");
  await upload(page, 2, "Small beanie worn");
  await page.getByLabel("Image 2 shows").click();
  await page.getByRole("option", { name: "Size / S" }).click();
  await page.getByRole("button", { name: "Save images" }).click();
  await expect(page.getByText("Images saved")).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(`/products/${product.slug}`);
  // M is picked first (S is sold out), so the S photo stays hidden.
  await expect(customer.getByRole("img", { name: "Beanie on a shelf" })).toBeVisible();
  await expect(customer.getByRole("button", { name: "Small beanie worn" })).toHaveCount(0);

  // Restock S so it can be picked.
  await page.getByLabel("New count for S").fill("3");
  await page.getByRole("button", { name: "Save stock" }).click();
  await expect(page.getByText("Stock saved")).toBeVisible();
  await customer.reload();
  await customer.getByRole("radio", { name: /^S/ }).check();
  const thumbnail = customer.getByRole("button", { name: "Small beanie worn" });
  await expect(thumbnail).toHaveAttribute("aria-current", "true");
  await expect(customer.getByRole("img", { name: "Small beanie worn" })).toBeVisible();
  await customer.getByRole("button", { name: "Beanie on a shelf" }).click();
  await expect(customer.getByRole("img", { name: "Beanie on a shelf" })).toBeVisible();
});

test("the description renders safe Markdown only, with a preview in the editor", async ({
  page,
  browser,
}) => {
  const product = await seedProduct({ stock: 3, label: "Rope basket" });
  await openEditor(page, product);

  await page
    .getByLabel("Description", { exact: true })
    .fill(
      "# Care\n\nWoven by **hand**.\n\n- Wipe clean\n- Keep dry\n\n<script>window.hacked = 1</script>\n\n[Our makers](https://example.com) and [bad](javascript:alert(1))",
    );
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("region", { name: "Description preview" });
  await expect(preview.getByRole("heading", { level: 2, name: "Care" })).toBeVisible();
  await page.getByRole("button", { name: "Write" }).click();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Details saved")).toBeVisible();

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(`/products/${product.slug}`);
  await expect(customer.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(customer.getByRole("heading", { level: 2, name: "Care" })).toBeVisible();
  await expect(customer.getByText("hand", { exact: true })).toBeVisible();
  await expect(customer.getByRole("listitem").filter({ hasText: "Keep dry" })).toBeVisible();
  await expect(customer.getByRole("link", { name: "Our makers" })).toHaveAttribute(
    "rel",
    "nofollow",
  );
  await expect(customer.getByRole("link", { name: "bad" })).toHaveCount(0);
  expect(await customer.evaluate(() => (window as { hacked?: number }).hacked)).toBeUndefined();
});

test("the Images section has no axe violations", async ({ page }) => {
  const product = await seedProductWithOptions();
  await openEditor(page, product);
  await upload(page, 1, "Beanie on a chair");
  await expectNoA11yViolations(page);
});
