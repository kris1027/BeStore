import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { latestEmailHtml, withDb } from "../admin/support";
import { seedProduct } from "../catalog/support";

// Customer accounts (spec 0012) against the real local stack: emails come through the Send Email
// Hook and the mailpit transport, and are read back from Mailpit.

export const customerPassword = "Garden-gnome-42";

export function uniqueEmail(label = "customer"): string {
  return `e2e-${label}-${randomUUID()}@example.com`;
}

// The /account/confirm link in the newest email for this address.
export async function accountLinkFor(email: string): Promise<string> {
  const html = await latestEmailHtml(email);
  const match = html.match(/href="([^"]*\/account\/confirm\?[^"]*)"/);
  if (!match?.[1]) throw new Error("No account link in the email.");
  return match[1].replaceAll("&amp;", "&");
}

export async function signUpWithEmail(page: Page, email: string) {
  await page.goto("/account/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

export async function choosePassword(page: Page, password = customerPassword) {
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Type it again").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
}

// Sign up, confirm from Mailpit and choose a password: an active account, signed in.
export async function createAccountThroughUi(page: Page, email = uniqueEmail()) {
  await signUpWithEmail(page, email);
  await page.goto(await accountLinkFor(email));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("/account/set-password");
  await choosePassword(page);
  await expect(page).toHaveURL("/account?notice=ready");
  return email;
}

export async function signInAsCustomer(page: Page, email: string, password = customerPassword) {
  await page.goto("/account/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export type PaidOrder = { readonly id: string; readonly number: number };

// A paid guest order for this email, as checkout and the webhook leave it.
export async function seedPaidOrder(
  email: string,
  options: {
    readonly status?: "paid" | "shipped" | "pending_payment";
    readonly quantity?: number;
  } = {},
): Promise<PaidOrder> {
  const product = await seedProduct({ stock: 20, priceCents: 1500, label: "Linen cap" });
  const status = options.status ?? "paid";
  const quantity = options.quantity ?? 2;
  const total = 1500 * quantity;
  return withDb(async (db) => {
    const order = await db.query<{ id: string; number: number }>(
      `INSERT INTO orders (id, status, email, currency, subtotal_cents, total_cents, paid_at,
         ship_full_name, ship_line1, ship_city, ship_postal_code, ship_country_code, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'EUR', $3, $3, $4, 'Anna Kowalska', 'ul. Długa 1',
         'Warsaw', '00-950', 'PL', now())
       RETURNING id, number`,
      [status, email, total, status === "pending_payment" ? null : new Date()],
    );
    const { id, number } = order.rows[0]!;
    await db.query(
      `INSERT INTO order_lines (id, order_id, variant_id, product_id, product_name, sku,
         unit_price_cents, quantity, line_total_cents)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'SKU-E2E', 1500, $5, $6)`,
      [id, product.variantId, product.id, product.name, quantity, total],
    );
    return { id, number };
  });
}

export async function orderCustomerId(orderId: string): Promise<string | null> {
  return withDb(async (db) => {
    const row = await db.query<{ customer_id: string | null }>(
      "SELECT customer_id FROM orders WHERE id = $1",
      [orderId],
    );
    return row.rows[0]?.customer_id ?? null;
  });
}
