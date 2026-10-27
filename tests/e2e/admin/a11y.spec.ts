import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { createTestUser, signInAsAdmin } from "./support";

// Spec 0004, AC-14, narrowed by spec 0019, AC-13 to the one admin auth page left: sign in, in
// its error states too, on desktop and phone.

test("sign in works by keyboard alone", async ({ page }) => {
  const admin = await createTestUser();
  await page.goto("/admin/sign-in");

  await page.getByLabel("Email").focus();
  await page.keyboard.type(admin.email);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type(admin.password);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/admin");
  await expect(page.getByText(`Signed in as ${admin.name}`)).toBeVisible();
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

test("the dashboard has no axe violations", async ({ page }) => {
  const admin = await createTestUser();
  await signInAsAdmin(page, admin);
  await expectNoA11yViolations(page);
});
