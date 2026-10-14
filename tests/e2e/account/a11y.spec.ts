import { expect, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { createTestUser, testPassword } from "../admin/support";
import {
  accountLinkFor,
  seedPaidOrder,
  signInAsCustomer,
  signUpWithEmail,
  uniqueEmail,
} from "./support";

// spec 0012, AC-25: every account page and dialog passes axe (desktop and phone projects), works
// by keyboard, and moves focus to the first invalid field.

test("the public account pages pass axe, empty, with errors and after sending", async ({
  page,
}) => {
  for (const path of ["/account/sign-in", "/account/sign-up", "/account/forgot-password"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoA11yViolations(page);
  }

  // A refused submit focuses the first invalid field.
  await page.goto("/account/sign-in");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Email")).toBeFocused();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/account/forgot-password");
  await page.getByLabel("Email").fill(uniqueEmail("nobody"));
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "a reset link is on its way" }),
  ).toBeVisible();
  await expectNoA11yViolations(page);

  const email = uniqueEmail("a11y");
  await signUpWithEmail(page, email);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
  await expectNoA11yViolations(page);

  await page.goto(await accountLinkFor(email));
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/account/confirm?token_hash=x&type=signup&failed=1");
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("the signed in account pages and dialogs pass axe", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  const order = await seedPaidOrder(customer.email);
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await expectNoA11yViolations(page);

  await page.goto(`/account/orders/${order.number}`);
  await expect(page.getByRole("heading", { name: `Order #${order.number}` })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto("/account/addresses");
  await page.getByRole("button", { name: "Add an address" }).click();
  const add = page.getByRole("dialog", { name: "Add an address" });
  await add.getByRole("button", { name: "Save address" }).click();
  await expect(add.getByText("Enter your full name.")).toBeVisible();
  await expectNoA11yViolations(page);
  await add.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/account/settings");
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByRole("dialog", { name: "Delete your account?" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("a customer signs in and opens an order by keyboard alone", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  const order = await seedPaidOrder(customer.email);
  await page.goto("/account/sign-in");

  await tabTo(page, page.getByLabel("Email"));
  await page.keyboard.type(customer.email);
  await tabTo(page, page.getByLabel("Password", { exact: true }));
  await page.keyboard.type(testPassword);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/account");

  const link = page.getByRole("link", { name: new RegExp(`Order #${order.number}`) });
  await tabTo(page, link);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/account/orders/${order.number}`);
});
