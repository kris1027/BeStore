import { expect, test } from "@playwright/test";

import { createTestUser, testPassword } from "../admin/support";
import { seedPaidOrder, signInAsCustomer } from "./support";

// spec 0012: profile, change password and delete account (AC-18, AC-19, AC-20).

test("a customer edits their details and changes their password", async ({ page, browser }) => {
  const customer = await createTestUser({ admin: false });
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signInAsCustomer(otherPage, customer.email, testPassword);
  await expect(otherPage).toHaveURL("/account");

  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText(customer.email)).toBeVisible();
  await expect(page.getByText("To change your email, contact us.")).toBeVisible();

  await page.getByLabel("Name (optional)").fill("Ada Lovelace");
  await page.getByLabel("Phone (optional)").fill("123");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(
    page.getByText("Enter a phone number with 7 to 15 digits, or leave it empty."),
  ).toBeVisible();
  await page.getByLabel("Phone (optional)").fill("+48 600 100 200");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Your details are saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Name (optional)")).toHaveValue("Ada Lovelace");

  await page.getByLabel("Current password").fill("Not-my-password-1");
  await page.getByLabel("New password").fill("Fresh-start-88");
  await page.getByLabel("Type it again").fill("Fresh-start-88");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your current password is not right.")).toBeVisible();
  await expect(page.getByLabel("Current password")).toBeFocused();

  await page.getByLabel("Current password").fill(testPassword);
  await page.getByLabel("New password").fill("Fresh-start-88");
  await page.getByLabel("Type it again").fill("Fresh-start-88");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your password is changed.")).toBeVisible();

  // This session stays; the other device is signed out.
  await page.goto("/account");
  await expect(page).toHaveURL("/account");
  await otherPage.goto("/account");
  await expect(otherPage).toHaveURL(/\/account\/sign-in/);
  await other.close();
});

test("a customer deletes their account after the open order warning", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  await seedPaidOrder(customer.email);
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await page.goto("/account/settings");

  await page.getByRole("button", { name: "Delete my account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await expect(
    dialog.getByText(
      `You have 1 order not shipped yet. They will still be delivered, and emails about them still go to ${customer.email}.`,
    ),
  ).toBeVisible();
  await dialog.getByLabel("Your password").fill("Wrong-password-1");
  await dialog.getByRole("button", { name: "Delete my account" }).click();
  await expect(dialog.getByText("Your current password is not right.")).toBeVisible();

  await dialog.getByLabel("Your password").fill(testPassword);
  await dialog.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL("/?notice=account_deleted");
  await expect(page.getByText("Your account is deleted.")).toBeVisible();

  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page.getByText("That email and password do not match.")).toBeVisible();
});

test("an admin cannot change their password or delete their account here", async ({ page }) => {
  const admin = await createTestUser();
  await signInAsCustomer(page, admin.email, testPassword);
  await expect(page).toHaveURL("/account");
  await page.goto("/account/settings");

  await page.getByLabel("Current password").fill(testPassword);
  await page.getByLabel("New password").fill("Fresh-start-88");
  await page.getByLabel("Type it again").fill("Fresh-start-88");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(
    page.getByText(
      "This account also runs the store. Use Forgot password on the admin sign in page.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Delete my account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete your account?" });
  await dialog.getByLabel("Your password").fill(testPassword);
  await dialog.getByRole("button", { name: "Delete my account" }).click();
  await expect(
    dialog.getByText("This account also runs the store, so it cannot be deleted here."),
  ).toBeVisible();
});
