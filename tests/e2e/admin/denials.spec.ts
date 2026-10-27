import { expect, type Page, test } from "@playwright/test";

import { seedProduct, waitForEditor } from "../catalog/support";
import { createTestUser, disableAdmin, injectSession, signInAsAdmin } from "./support";

// Spec 0004, AC-6: anyone who is not an active admin gets the store's plain 404.
async function expectNotFound(page: Page) {
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);
}

// The tab title is a hint too: a denied page load must carry the store 404 title, not the
// admin page's own (Next.js resolves metadata apart from the page render).
async function expectNotFoundTitle(page: Page) {
  await expect(page).toHaveTitle("Page not found · BeStore");
}

test("a signed in non admin gets a 404 on admin pages", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  await injectSession(page, customer);

  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await expectNotFound(page);
  await expectNotFoundTitle(page);
  // The served HTML too, before any script runs: no admin title or title template in it.
  const html = await (await page.request.get("/admin")).text();
  expect(html).toContain("<title>Page not found · BeStore</title>");
  expect(html).not.toMatch(/Dashboard|· Admin/);

  const mfa = await page.goto("/admin/mfa");
  expect(mfa?.status()).toBe(404);
  await expectNotFound(page);
  await expectNotFoundTitle(page);
});

test("a disabled admin gets a 404 on their next page and their next action", async ({ page }) => {
  const product = await seedProduct({ stock: 1, label: "Disabled action" });
  const admin = await createTestUser();
  await signInAsAdmin(page, admin);
  await page.goto(`/admin/products/${product.id}`);
  await waitForEditor(page, product.name);

  await disableAdmin(admin.id);

  // The action runs requireAdmin() itself, even though the page was rendered while active.
  await page.getByLabel("Name", { exact: true }).fill("Changed by a disabled admin");
  await page.getByRole("button", { name: "Save details" }).click();
  await expectNotFound(page);

  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await expectNotFound(page);
  await expectNotFoundTitle(page);
});
