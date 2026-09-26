import { expect, test } from "@playwright/test";

import {
  createTestUser,
  enterCode,
  latestEmailHtml,
  resetLinkFrom,
  signInWithPassword,
  totpCode,
} from "./support";

// Spec 0004, AC-9 and AC-10. The email comes from Mailpit on the local Supabase stack.
const sentMessage = "If that email belongs to an admin, a reset link is on its way.";

async function requestReset(page: import("@playwright/test").Page, email: string) {
  await page.goto("/admin/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status").filter({ hasText: sentMessage })).toBeVisible();
}

test("an admin resets their password with the email link and their TOTP code", async ({
  page,
  request,
}) => {
  const admin = await createTestUser({ enrolled: true });
  await requestReset(page, admin.email);
  const link = resetLinkFrom(await latestEmailHtml(admin.email));

  // A plain GET, like a mail scanner, spends nothing.
  const scanned = await request.get(link, { maxRedirects: 0 });
  expect(scanned.status()).toBe(200);

  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/admin/mfa?next=%2Fadmin%2Freset-password");
  await enterCode(page, await totpCode(admin.secret ?? ""));

  await expect(page).toHaveURL("/admin/reset-password");
  await page.getByLabel("New password").fill("short");
  await page.getByLabel("Type it again").fill("short");
  await page.getByRole("button", { name: "Save new password" }).click();
  for (const part of ["at least 8 characters", "an upper case letter", "a digit", "a symbol"]) {
    await expect(page.getByText(`Missing: ${part}`)).toBeVisible();
  }
  await expect(page.getByText("Missing: a lower case letter")).toHaveCount(0);

  await page.getByLabel("New password").fill(admin.password);
  await page.getByLabel("Type it again").fill(admin.password);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("Choose a password you have not used here before.")).toBeVisible();

  const newPassword = "Brand-new-pass-7";
  await page.getByLabel("New password").fill(newPassword);
  await page.getByLabel("Type it again").fill(newPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page).toHaveURL("/admin");
  await expect(page.getByText(`Signed in as ${admin.name}`)).toBeVisible();

  // The link works once.
  await page.context().clearCookies();
  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/admin/sign-in?reason=invalid_link");
  await expect(
    page.getByText("That link is invalid or has expired. Request a new one."),
  ).toBeVisible();

  await signInWithPassword(page, { ...admin, password: newPassword });
});

test("an unknown email gets the same reply and no email", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  await requestReset(page, customer.email);

  // Give a send that should not happen time to land, then check Mailpit holds nothing.
  await page.waitForTimeout(1_500);
  const search = await fetch(
    `http://127.0.0.1:55324/api/v1/search?query=${encodeURIComponent(`to:"${customer.email}"`)}`,
  );
  expect(((await search.json()) as { messages_count: number }).messages_count).toBe(0);
});

test("an admin with no authenticator cannot set one up from a reset link", async ({ page }) => {
  const admin = await createTestUser();
  await requestReset(page, admin.email);
  const link = resetLinkFrom(await latestEmailHtml(admin.email));

  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByText("Your authenticator is not set up. Contact the store owner."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up authenticator" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("a tampered link lands on sign in with the invalid link message", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=not-a-real-token&type=recovery");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL("/admin/sign-in?reason=invalid_link");
});
