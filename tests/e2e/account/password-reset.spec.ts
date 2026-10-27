import { expect, test } from "@playwright/test";

import { createTestUser, recoveryTokenHash, testPassword } from "../admin/support";
import { accountLinkFor, choosePassword, signInAsCustomer, uniqueEmail } from "./support";

// spec 0012: forgot password through the Send Email Hook (AC-8, AC-9, AC-2, AC-3), and spec 0019
// AC-8 and AC-9: nothing for a user who runs the store.

const sent = "If there is an account for that email, a reset link is on its way.";

async function requestReset(page: import("@playwright/test").Page, email: string) {
  await page.goto("/account/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status").filter({ hasText: sent })).toBeVisible();
}

test("a customer resets their password from the email and every old session ends", async ({
  page,
  browser,
}) => {
  const customer = await createTestUser({ admin: false });
  // A session on another device, which the reset signs out.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signInAsCustomer(otherPage, customer.email, testPassword);
  await expect(otherPage).toHaveURL("/account");

  await requestReset(page, customer.email);
  const link = await accountLinkFor(customer.email);
  expect(link).toContain("type=recovery");
  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/account/set-password?from=reset");

  await choosePassword(page, testPassword);
  await expect(page.getByText("Choose a password you have not used here before.")).toBeVisible();
  await choosePassword(page, "Fresh-start-77");
  await expect(page).toHaveURL("/account?notice=password_changed");
  await expect(page.getByText("Your password is changed.")).toBeVisible();

  await otherPage.goto("/account");
  await expect(otherPage).toHaveURL(/\/account\/sign-in/);
  await other.close();

  await page.context().clearCookies();
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page.getByText("That email and password do not match.")).toBeVisible();
  await signInAsCustomer(page, customer.email, "Fresh-start-77");
  await expect(page).toHaveURL("/account");
});

async function expectNoEmail(email: string) {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const search = await fetch(
    `http://127.0.0.1:55324/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
  );
  expect(((await search.json()) as { messages_count: number }).messages_count).toBe(0);
}

test("an unknown email gets the same reply and no email", async ({ page }) => {
  const email = uniqueEmail("nobody");
  await requestReset(page, email);
  await expectNoEmail(email);
});

test("an admin asking here gets the same reply and no email", async ({ page }) => {
  const admin = await createTestUser();
  await requestReset(page, admin.email);
  await expectNoEmail(admin.email);
});

test("a recovery link for an admin made outside the app changes no password", async ({ page }) => {
  const admin = await createTestUser();
  const tokenHash = await recoveryTokenHash(admin.email);

  await page.goto(`/account/confirm?token_hash=${tokenHash}&type=recovery`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/account/confirm?failed=1&type=recovery");
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();
  // The session the link opened is ended on this device.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account\/sign-in/);
});

test("an expired reset link offers a new one", async ({ page }) => {
  await page.goto("/account/confirm?token_hash=not-a-real-token&type=recovery");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();
  await page.getByRole("link", { name: "Ask for a new reset link" }).click();
  await expect(page).toHaveURL("/account/forgot-password");
});
