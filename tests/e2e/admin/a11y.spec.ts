import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { createTestUser, enterCode, signInFully, signInWithPassword, totpCode } from "./support";

// Spec 0004, AC-14: every auth page, in its error states too, on desktop and phone.

test("sign in works by keyboard alone", async ({ page }) => {
  const admin = await createTestUser({ enrolled: true });
  await page.goto("/admin/sign-in");

  await page.getByLabel("Email").focus();
  await page.keyboard.type(admin.email);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type(admin.password);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/admin/mfa");
  await page.getByLabel("6 digit code").focus();
  await page.keyboard.type(await totpCode(admin.secret ?? ""));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/admin");
});

test("sign in has no axe violations, empty and with errors", async ({ page }) => {
  await page.goto("/admin/sign-in?reason=expired");
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your email address")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByLabel("Email").fill("nobody-here@example.com");
  await page.getByLabel("Password").fill("Wrong-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("forgot password has no axe violations", async ({ page }) => {
  await page.goto("/admin/forgot-password");
  await expectNoA11yViolations(page);

  await page.getByLabel("Email").fill("nobody-here@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible();
  await expectNoA11yViolations(page);
});

test("the MFA views have no axe violations", async ({ page }) => {
  const newAdmin = await createTestUser();
  await signInWithPassword(page, newAdmin);
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expectNoA11yViolations(page);

  await enterCode(page, "000000", "Verify and continue");
  await expect(page.getByText("That code is incorrect.", { exact: false })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("reset password has no axe violations, with errors", async ({ page }) => {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto("/admin/reset-password");
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("Missing: at least 8 characters")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("the welcome page has no axe violations", async ({ page }) => {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await expectNoA11yViolations(page);
});
