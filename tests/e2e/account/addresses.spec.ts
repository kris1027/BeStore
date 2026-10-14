import { expect, type Page, test } from "@playwright/test";

import { createTestUser, testPassword, withDb } from "../admin/support";
import { signInAsCustomer } from "./support";

// spec 0012, AC-14: the address book.

async function addAddress(page: Page, line1: string, city = "Warsaw") {
  await page.getByRole("button", { name: "Add an address" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an address" });
  await dialog.getByLabel("Full name").fill("Anna Kowalska");
  await dialog.getByLabel("Address line 1").fill(line1);
  await dialog.getByLabel("Postal code").fill("00950");
  await dialog.getByLabel("City").fill(city);
  await dialog.getByRole("button", { name: "Save address" }).click();
  await expect(dialog).toBeHidden();
}

const cards = (page: Page) =>
  page.getByRole("list", { name: "Saved addresses" }).getByRole("listitem");

test("a customer adds, edits, defaults and deletes addresses", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  await signInAsCustomer(page, customer.email, testPassword);
  await page.getByRole("link", { name: "Addresses" }).click();
  await expect(page).toHaveURL("/account/addresses");

  // Every field is checked with checkout's rules, and the first invalid one gets focus.
  await page.getByRole("button", { name: "Add an address" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an address" });
  await dialog.getByRole("button", { name: "Save address" }).click();
  await expect(dialog.getByText("Enter your full name.")).toBeVisible();
  await expect(dialog.getByLabel("Full name")).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await addAddress(page, "ul. Długa 1");
  await addAddress(page, "ul. Krótka 2", "Kraków");
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).first()).toContainText("Default");
  await expect(cards(page).first()).toContainText("ul. Długa 1");
  await expect(cards(page).first()).toContainText("00-950");

  await page
    .getByRole("button", { name: "Make default: Anna Kowalska, ul. Krótka 2, Kraków" })
    .click();
  await expect(cards(page).first()).toContainText("ul. Krótka 2");
  await expect(cards(page).first()).toContainText("Default");

  await page.getByRole("button", { name: "Edit: Anna Kowalska, ul. Długa 1, Warsaw" }).click();
  const edit = page.getByRole("dialog", { name: "Edit address" });
  await edit.getByLabel("City").fill("Gdańsk");
  await edit.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Gdańsk")).toBeVisible();

  await page.getByRole("button", { name: "Delete: Anna Kowalska, ul. Krótka 2, Kraków" }).click();
  await page.getByRole("button", { name: "Delete address" }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText("Default");
});

test("an address the rules now refuse is flagged, and at 10 there is no Add", async ({ page }) => {
  const customer = await createTestUser({ admin: false });
  await signInAsCustomer(page, customer.email, testPassword);
  await expect(page).toHaveURL("/account");
  await withDb(async (db) => {
    for (let i = 0; i < 10; i += 1) {
      await db.query(
        `INSERT INTO customer_addresses (id, customer_id, full_name, line1, city, postal_code,
           country_code, is_default, updated_at)
         VALUES (gen_random_uuid(), $1, 'Anna Kowalska', $2, 'Warsaw', $3, 'PL', $4, now())`,
        [customer.id, `ul. Długa ${i + 1}`, i === 0 ? "12345" : "00-950", i === 0],
      );
    }
  });

  await page.goto("/account/addresses");
  await expect(page.getByText("You can save up to 10 addresses.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add an address" })).toHaveCount(0);
  await expect(cards(page).filter({ hasText: "Check this address" })).toHaveCount(1);
});
