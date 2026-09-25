import { expect, type Page, test } from "@playwright/test";

import { createTestUser, disableAdmin, injectSession, signInFully } from "./support";

// Spec 0004, AC-6: anyone who is not an active admin gets the store's plain 404.
async function expectNotFound(page: Page) {
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);
}

test("a signed in non admin gets a 404 on admin pages", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  await injectSession(page, customer);

  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await expectNotFound(page);

  const mfa = await page.goto("/admin/mfa");
  expect(mfa?.status()).toBe(404);
});

test("a disabled admin gets a 404 on their next page and their next action", async ({ page }) => {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto("/admin/reset-password");
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

  await disableAdmin(admin.id);

  // The action runs requireAdmin() itself, even though the page was rendered while active.
  await page.getByLabel("New password").fill("Another-pass-9!");
  await page.getByLabel("Type it again").fill("Another-pass-9!");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expectNotFound(page);

  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await expectNotFound(page);
});
