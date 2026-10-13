import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { seedProduct } from "../catalog/support";
import { type SeededOrder, seedPendingOrder } from "../checkout/support";
import { createTestUser, signInFully, withDb } from "./support";

// spec 0011, AC-13, AC-14 and AC-18: the order page's Emails section and Send again, by keyboard,
// with no axe violations, on desktop and phone. The app runs with EMAIL_TRANSPORT=log, so a
// queued email is "sent" without leaving the machine.

async function paidOrderWithEmails(): Promise<SeededOrder & { failedId: string }> {
  const product = await seedProduct({ stock: 5, priceCents: 1500 });
  const cartId = await withDb(async (db) => {
    const cart = await db.query<{ id: string }>(
      "INSERT INTO carts (id, expires_at) VALUES (gen_random_uuid(), now() + interval '30 days') RETURNING id",
    );
    return cart.rows[0]!.id;
  });
  const order = await seedPendingOrder(cartId, product, {
    quantity: 1,
    priceCents: 1500,
    shippingCents: 0,
  });
  const failedId = await withDb(async (db) => {
    await db.query(
      `UPDATE orders SET status = 'shipped', paid_at = now(), shipped_at = now(),
         needs_attention = true, cart_id = NULL, updated_at = now()
       WHERE id = $1`,
      [order.id],
    );
    // The confirmation gave up after 23 hours; the shipped email was sent.
    const failed = await db.query<{ id: string }>(
      `INSERT INTO email_sends (order_id, kind, dedupe_key, status, attempts, error_code,
         created_at, queued_at)
       VALUES ($1::uuid, 'order_confirmation', 'order_confirmation:' || $1::text, 'failed', 3, 'gave_up',
         now() - interval '1 day', now() - interval '1 day')
       RETURNING id`,
      [order.id],
    );
    await db.query(
      `INSERT INTO email_sends (order_id, kind, dedupe_key, status, attempts, sent_at)
       VALUES ($1::uuid, 'order_shipped', 'order_shipped:' || $1::text, 'sent', 1, now())`,
      [order.id],
    );
    return failed.rows[0]!.id;
  });
  return { ...order, failedId };
}

function emails(page: Page) {
  return page.getByRole("list", { name: "Emails, newest first" });
}

function dialog(page: Page) {
  return page.locator('[data-slot="dialog-content"]');
}

test("an admin sees the order's emails and sends a failed one again by keyboard", async ({
  page,
}) => {
  const order = await paidOrderWithEmails();
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto(`/admin/orders/${order.number}`);
  await expect(page.getByRole("heading", { level: 2, name: "Emails" })).toBeVisible();

  // AC-13: plain words, never a raw error code by itself.
  await expect(emails(page).getByText("Order confirmation", { exact: true })).toBeVisible();
  await expect(
    emails(page).getByText("Failed: Gave up after 23 hours, it may have been sent"),
  ).toBeVisible();
  await expect(emails(page).getByText("3 attempts")).toBeVisible();
  await expect(emails(page).getByText(/^Sent /)).toBeVisible();
  await expectNoA11yViolations(page);

  // AC-14: one Send again, on the failed row only, behind a confirm that warns about a duplicate.
  const trigger = page.getByRole("button", { name: "Send again (Order confirmation email)" });
  await expect(page.getByRole("button", { name: /^Send again/ })).toHaveCount(1);
  await tabTo(page, trigger, 150);
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await expect(
    dialog(page).getByText(
      "This email may already have reached the customer. Sending again could deliver it twice.",
    ),
  ).toBeVisible();
  await expect(
    dialog(page).getByText(
      "If it was already delivered in the last 24 hours, it will not be sent again.",
    ),
  ).toBeVisible();
  // AC-18: focus moved into the dialog.
  await expect(dialog(page).locator(":focus")).toHaveCount(1);
  await expectNoA11yViolations(page);

  // Escape closes it and gives focus back to its trigger.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await tabTo(page, dialog(page).getByRole("button", { name: "Send again" }));
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeHidden();

  await expect(
    page
      .getByRole("list", { name: "History, newest first" })
      .getByText("Order confirmation email queued again"),
  ).toBeVisible();
  await expect(trigger).toBeHidden();
  // The log transport settles it after the response; a reload shows where it is now.
  await expect(async () => {
    await page.reload();
    await expect(emails(page).getByText(/^Sent /)).toHaveCount(2);
  }).toPass({ timeout: 15_000 });
  await expectNoA11yViolations(page);

  const row = await withDb((db) =>
    db.query<{ status: string; error_code: string | null }>(
      "SELECT status, error_code FROM email_sends WHERE id = $1",
      [order.failedId],
    ),
  );
  expect(row.rows[0]).toEqual({ status: "sent", error_code: null });
});

test("an order with no emails says so", async ({ page }) => {
  const product = await seedProduct({ stock: 5, priceCents: 1500 });
  const cartId = await withDb(async (db) => {
    const cart = await db.query<{ id: string }>(
      "INSERT INTO carts (id, expires_at) VALUES (gen_random_uuid(), now() + interval '30 days') RETURNING id",
    );
    return cart.rows[0]!.id;
  });
  const order = await seedPendingOrder(cartId, product, { quantity: 1, priceCents: 1500 });
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto(`/admin/orders/${order.number}`);

  await expect(page.getByText("No emails sent for this order.")).toBeVisible();
});
