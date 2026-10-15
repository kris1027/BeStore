import { expect, test } from "@playwright/test";

import { createTestUser, testPassword, withDb } from "../admin/support";
import { signInAsCustomer } from "./support";

// spec 0012, Critical test scenarios: what a customer session can never reach (AC-13, AC-20,
// AC-22).

test("a customer session cannot open /admin", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");

  for (const path of ["/admin", "/admin/orders", "/admin/products"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
    await expect(page.getByText(/Signed in as/)).toHaveCount(0);
  }
});

test("Back after sign out shows no account data", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await page.goto("/account/settings");
  await expect(page.getByText(customer.email)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");

  // Back, and Back again past the replaced entry: no page shows the account.
  await page.goBack();
  await expect(page.getByText(customer.email)).toHaveCount(0);
  await page.goBack();
  await expect(page.getByText(customer.email)).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/account\/settings$/);
});

test("a deleted account's session on another device cannot read or write anything", async ({
  page,
  browser,
}) => {
  const customer = await createTestUser({ admin: false });
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signInAsCustomer(otherPage, customer.email, testPassword);
  await expect(otherPage).toHaveURL("/account");
  await otherPage.goto("/account/addresses");
  await otherPage.getByRole("button", { name: "Add an address" }).click();
  const dialog = otherPage.getByRole("dialog", { name: "Add an address" });
  await dialog.getByLabel("Full name").fill("Anna Kowalska");
  await dialog.getByLabel("Address line 1").fill("ul. Długa 1");
  await dialog.getByLabel("Postal code").fill("00950");
  await dialog.getByLabel("City").fill("Warsaw");

  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await page.goto("/account/settings");
  await page.getByRole("button", { name: "Delete my account" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete your account?" });
  await confirm.getByLabel("Your password").fill(testPassword);
  await confirm.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL("/?notice=account_deleted");

  // The other device's open form writes nothing, and its pages send it to sign in.
  await dialog.getByRole("button", { name: "Save address" }).click();
  await expect(otherPage).toHaveURL(/\/account\/sign-in/);
  await otherPage.goto("/account");
  await expect(otherPage).toHaveURL(/\/account\/sign-in/);
  await otherPage.goto("/account/addresses");
  await expect(otherPage).toHaveURL(/\/account\/sign-in/);

  // Nothing recreated the customer row or saved the address.
  const rows = await withDb(async (db) => {
    const found = await db.query<{ customers: string; addresses: string }>(
      `SELECT (SELECT count(*) FROM customers WHERE id = $1) AS customers,
              (SELECT count(*) FROM customer_addresses WHERE customer_id = $1) AS addresses`,
      [customer.id],
    );
    return found.rows[0];
  });
  expect(rows).toEqual({ customers: "0", addresses: "0" });
  await other.close();
});
