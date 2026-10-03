import { expect, test } from "@playwright/test";

import { seedProduct, waitForEditor } from "../catalog/support";
import { createTestUser, disableAdmin, injectSession, signInFully } from "./support";

// spec 0009, AC-22: every new admin page answers a non admin with the store's 404, and every
// action checks the admin again, whatever the page showed.

test("a signed in non admin gets a 404 on every catalog admin page", async ({ page }) => {
  const product = await seedProduct({ stock: 1, label: "Denied" });
  const customer = await createTestUser({ admin: false });
  await injectSession(page, customer);

  for (const path of [
    `/admin/products/${product.id}`,
    "/admin/products/arrange",
    "/admin/categories",
    "/admin/categories/new",
    "/admin/categories/01890000-0000-7000-8000-000000000000",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  }
});

test("a signed out visitor is sent to sign in", async ({ page }) => {
  await page.goto("/admin/categories");
  await expect(page).toHaveURL(/\/admin\/sign-in/);
});

test("a disabled admin's catalog save changes nothing", async ({ page }) => {
  const product = await seedProduct({ stock: 1, label: "Disabled save" });
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto(`/admin/products/${product.id}`);
  await waitForEditor(page, product.name);

  await disableAdmin(admin.id);
  await page.getByLabel("Name", { exact: true }).fill("Changed by a disabled admin");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();

  const other = await (await page.context().browser()!.newContext()).newPage();
  await other.goto(`/products/${product.slug}`);
  await expect(other.getByRole("heading", { level: 1, name: product.name })).toBeVisible();
});
