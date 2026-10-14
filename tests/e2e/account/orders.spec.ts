import { expect, test } from "@playwright/test";

import { createTestUser, signInFully, testPassword } from "../admin/support";
import { seedPaidOrder, signInAsCustomer } from "./support";

// spec 0012: order history and one order (AC-10, AC-11, AC-12, AC-13).

test("a customer sees their paid orders, opens one, and never sees anyone else's", async ({
  page,
}) => {
  const customer = await createTestUser({ admin: false });
  const someoneElse = await createTestUser({ admin: false });
  const paid = await seedPaidOrder(customer.email, { quantity: 3 });
  const pending = await seedPaidOrder(customer.email, { status: "pending_payment" });
  const theirs = await seedPaidOrder(someoneElse.email);

  // Sign in links the guest orders placed with this email (AC-10).
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");

  const row = page.getByRole("link", { name: new RegExp(`Order #${paid.number}`) });
  await expect(row).toContainText("Paid");
  await expect(row).toContainText("3 items");
  await expect(row).toContainText("€45.00");
  await expect(
    page.getByRole("link", { name: new RegExp(`Order #${pending.number}`) }),
  ).toHaveCount(0);

  await row.click();
  await expect(page).toHaveURL(`/account/orders/${paid.number}`);
  await expect(page.getByRole("heading", { name: `Order #${paid.number}` })).toBeVisible();
  await expect(page.getByText("3 × €15.00")).toBeVisible();
  await expect(page.getByText("Anna Kowalska")).toBeVisible();
  await expect(page.getByText("Free", { exact: true })).toBeVisible();

  // Another customer's order and a pending one read exactly like a missing one (AC-13).
  for (const number of [theirs.number, pending.number, 99_999_999]) {
    await page.goto(`/account/orders/${number}`);
    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  }
});

test("a new account with no orders sees the empty state", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  await signInAsCustomer(page, customer.email, testPassword);

  await expect(page.getByText("No orders yet.")).toBeVisible();
  await page.getByRole("link", { name: "Go to the shop" }).click();
  await expect(page).toHaveURL("/");
});

// AC-21: the admin sees whether an order belongs to an account.
test("the admin order pages show Account for a linked order and Guest for the rest", async ({
  page,
  browser,
}) => {
  const customer = await createTestUser({ admin: false });
  const linked = await seedPaidOrder(customer.email);
  const guest = await seedPaidOrder(`e2e-guest-${Date.now()}@example.com`);
  const customerPage = await (await browser.newContext()).newPage();
  await signInAsCustomer(customerPage, customer.email, testPassword);
  await expect(customerPage).toHaveURL("/account");

  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  for (const [order, label] of [
    [linked, "Account"],
    [guest, "Guest"],
  ] as const) {
    await page.goto(`/admin/orders/${order.number}`);
    const row = page.getByRole("term").filter({ hasText: /^Customer$/ });
    await expect(row.locator("xpath=following-sibling::dd[1]")).toHaveText(label);
  }
});
