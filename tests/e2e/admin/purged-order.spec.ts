import { expect, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { seedProduct } from "../catalog/support";
import { seedPendingOrder } from "../checkout/support";
import { createTestUser, signInFully, withDb } from "./support";

// spec 0008, AC-4 and AC-8: a real cron call purges an old expired order, and both admin pages
// say its personal data was removed, by keyboard and with no axe violations.

const cronSecret = process.env.CRON_SECRET;

test("an expired order past retention shows its personal data as removed", async ({
  page,
  request,
}) => {
  test.skip(!cronSecret, "CRON_SECRET is not set");
  const mug = await seedProduct({ stock: 5, priceCents: 1250 });
  const cartId = await withDb(async (db) => {
    const cart = await db.query<{ id: string }>(
      "INSERT INTO carts (id, expires_at) VALUES (gen_random_uuid(), now() + interval '30 days') RETURNING id",
    );
    return cart.rows[0]!.id;
  });
  const order = await seedPendingOrder(cartId, mug, {
    quantity: 1,
    priceCents: 1250,
    shippingCents: 990,
  });
  await withDb((db) =>
    db.query(
      `UPDATE orders SET status = 'expired', expired_at = now() - interval '31 days'
       WHERE id = $1`,
      [order.id],
    ),
  );

  const response = await request.get("/api/cron/purge-expired-orders", {
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  expect(response.status()).toBe(200);
  // A count, not 1: the desktop and phone runs overlap, and either cron call may take both rows.
  expect(typeof (await response.json()).purged).toBe("number");
  const purgedAt = await withDb(async (db) => {
    const rows = await db.query<{ pii_purged_at: Date | null }>(
      "SELECT pii_purged_at FROM orders WHERE id = $1",
      [order.id],
    );
    return rows.rows[0]?.pii_purged_at ?? null;
  });
  expect(purgedAt).not.toBeNull();

  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto("/admin/orders?view=all");
  const row = page.getByRole("row", { name: new RegExp(`#${order.number}`) });
  // Email and Ship to both say so.
  await expect(row.getByText("Personal data removed")).toHaveCount(2);
  await expect(row).not.toContainText("e2e.customer@example.com");
  await expectNoA11yViolations(page);

  const link = row.getByRole("link", { name: `#${order.number}` });
  await tabTo(page, link, 80);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: `Order #${order.number}` }),
  ).toBeVisible();
  await expect(page.getByText(/^Personal data removed on /)).toHaveCount(2);
  await expect(page.locator("address")).toHaveCount(0);
  await expectNoA11yViolations(page);
});
