import { expect, type Page, test } from "@playwright/test";
import Stripe from "stripe";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { seedProduct, type SeededProduct } from "../catalog/support";
import { hasRealStripeKey, type SeededOrder, seedPendingOrder } from "../checkout/support";
import { createTestUser, signInFully, withDb } from "./support";

// spec 0010: run an order after payment from the admin pages, by keyboard, with no axe
// violations (AC-4 to AC-7, AC-19, AC-21, AC-24) and the list filters (AC-1 to AC-3). The refund
// and cancel flows reach Stripe for real and run only with STRIPE_E2E=1 (AC-10, AC-14).

async function newCart() {
  return withDb(async (db) => {
    const cart = await db.query<{ id: string }>(
      "INSERT INTO carts (id, expires_at) VALUES (gen_random_uuid(), now() + interval '30 days') RETURNING id",
    );
    return cart.rows[0]!.id;
  });
}

// A paid order as the webhook leaves it: status, payment intent, and the sale movement.
async function seedPaidOrder(
  product: SeededProduct,
  options: { quantity: number; priceCents: number; paymentIntentId?: string },
): Promise<SeededOrder> {
  const order = await seedPendingOrder(await newCart(), product, {
    ...options,
    shippingCents: 0,
  });
  await withDb(async (db) => {
    await db.query(
      `UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now(),
         stripe_payment_intent_id = $2, cart_id = NULL
       WHERE id = $1`,
      [order.id, options.paymentIntentId ?? `pi_e2e_${order.id.replace(/-/g, "")}`],
    );
    const stock = await db.query<{ stock_quantity: number }>(
      `UPDATE product_variants SET stock_quantity = stock_quantity - $2 WHERE id = $1
       RETURNING stock_quantity`,
      [product.variantId, options.quantity],
    );
    await db.query(
      `INSERT INTO stock_movements (id, variant_id, kind, delta, stock_after, actor_type, order_id)
       VALUES (gen_random_uuid(), $1, 'sale', $2, $3, 'system', $4)`,
      [product.variantId, -options.quantity, stock.rows[0]!.stock_quantity, order.id],
    );
  });
  return order;
}

async function stockOf(variantId: string) {
  return withDb(async (db) => {
    const rows = await db.query<{ stock_quantity: number }>(
      "SELECT stock_quantity FROM product_variants WHERE id = $1",
      [variantId],
    );
    return rows.rows[0]!.stock_quantity;
  });
}

async function openOrder(page: Page, order: SeededOrder) {
  await page.goto(`/admin/orders/${order.number}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Order #${order.number}` }),
  ).toBeVisible();
}

// Opens an action's dialog from the keyboard: tab to its trigger, press Enter.
async function openByKeyboard(page: Page, name: string | RegExp) {
  const trigger = page.getByRole("button", { name, exact: typeof name === "string" });
  await expect(trigger).toBeEnabled();
  await tabTo(page, trigger, 120);
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
}

// The action dialog, not a toast (toasts are dialogs too).
function dialog(page: Page) {
  return page.locator('[data-slot="dialog-content"]');
}

function history(page: Page) {
  return page.getByRole("list", { name: "History, newest first" });
}

test("an admin ships, delivers, undoes, edits tracking and notes an order by keyboard", async ({
  page,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  const order = await seedPaidOrder(socks, { quantity: 1, priceCents: 1250 });
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await openOrder(page, order);
  await expectNoA11yViolations(page);

  // AC-4: focus moves into the dialog, onto its fields.
  await openByKeyboard(page, "Mark shipped");
  await expect(page.getByLabel("Carrier")).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Tab");
  await page.getByLabel("Carrier").fill("DHL");
  await page.getByLabel("Tracking number").fill("JD0001");
  await page.getByLabel("Tracking number").press("Enter");
  await expect(dialog(page)).toBeHidden();
  await expect(history(page).getByText("Carrier: DHL, tracking: JD0001")).toBeVisible();
  await expect(history(page).getByText(admin.name).first()).toBeVisible();

  // AC-7: a save that changes nothing is refused.
  await openByKeyboard(page, "Edit tracking");
  await page.getByRole("button", { name: "Save tracking" }).click();
  await expect(dialog(page).getByText("Nothing changed.")).toBeVisible();
  await page.getByLabel("Tracking number").fill("JD0002");
  await page.getByRole("button", { name: "Save tracking" }).click();
  await expect(history(page).getByText("Tracking: JD0001 → JD0002")).toBeVisible();

  // AC-5, then AC-6: back to shipped needs a reason, linked to its field.
  await openByKeyboard(page, "Mark delivered");
  await dialog(page).getByRole("button", { name: "Mark delivered" }).click();
  await expect(dialog(page)).toBeHidden();
  await openByKeyboard(page, /Undo: back to Shipped/);
  await dialog(page).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Reason")).toHaveAccessibleDescription("Give a reason.");
  await expect(page.getByLabel("Reason")).toBeFocused();
  await page.getByLabel("Reason").fill("Marked by mistake");
  await dialog(page).getByRole("button", { name: "Undo" }).click();
  await expect(history(page).getByText("Marked by mistake")).toBeVisible();
  // Closing a dialog gives focus back to the page, not the void.
  await expect(page.getByRole("button", { name: "Mark delivered" })).toBeVisible();

  // AC-19.
  await page.getByLabel("Add a note").fill("Customer asked for gift wrap");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(history(page).getByText("Customer asked for gift wrap")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("the refund and cancel dialogs work by keyboard alone", async ({ page }) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1000 });
  const order = await seedPaidOrder(socks, { quantity: 2, priceCents: 1000 });
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await openOrder(page, order);

  // AC-24: focus moves into the refund form; every field is reachable by Tab; an error is
  // announced on its field and takes focus; Escape gives focus back to the trigger.
  await openByKeyboard(page, "Refund");
  await expect(dialog(page)).toContainText("Refund");
  const units = page.getByLabel(/^Units of /);
  await tabTo(page, units);
  await page.keyboard.type("1");
  await tabTo(page, page.getByRole("checkbox", { name: "Return to stock" }));
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: "Return to stock" })).toBeChecked();
  await expect(page.getByLabel(/^Amount/)).toHaveValue("10.00");
  await expectNoA11yViolations(page);
  await tabTo(page, dialog(page).getByRole("button", { name: "Review refund" }));
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Reason")).toHaveAccessibleDescription(/Give a reason\./);
  await expect(page.getByLabel("Reason")).toBeFocused();
  await page.keyboard.type("One pair returned");
  await tabTo(page, dialog(page).getByRole("button", { name: "Review refund" }));
  await page.keyboard.press("Enter");
  // The confirm step repeats the choice before anything reaches Stripe (AC-10).
  await expect(dialog(page).getByRole("button", { name: "Refund now" })).toBeVisible();
  await expect(dialog(page).getByText("One pair returned")).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Refund", exact: true })).toBeFocused();

  // AC-14: the cancel dialog, the same way.
  await openByKeyboard(page, "Cancel and refund");
  await expect(page.getByRole("checkbox", { name: /2 × / })).toBeChecked();
  await expectNoA11yViolations(page);
  await tabTo(page, dialog(page).getByRole("button", { name: "Cancel and refund" }));
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Reason")).toHaveAccessibleDescription(/Give a reason\./);
  await expect(page.getByLabel("Reason")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Cancel and refund" })).toBeFocused();
  // Nothing was sent: the order is untouched.
  await expect(page.getByText("Not refunded").first()).toBeVisible();
});

test("the orders list filters by number, keeps filters in the URL and has an empty state", async ({
  page,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 900 });
  const order = await seedPaidOrder(socks, { quantity: 1, priceCents: 900 });
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await page.goto("/admin/orders");

  await page.getByLabel("Order number, email or name").fill(String(order.number));
  await page.getByLabel("Order number, email or name").press("Enter");
  await expect(page).toHaveURL(new RegExp(`q=${order.number}`));
  await expect(page.getByRole("link", { name: `#${order.number}` })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(2);
  await expectNoA11yViolations(page);

  await page.goto("/admin/orders?q=no-such-customer-anywhere&status=all");
  await expect(page.getByRole("heading", { name: "No orders match these filters." })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expectNoA11yViolations(page);
});

// ─── With Stripe (STRIPE_E2E=1) ──────────────────────────────────────────────

const stripeE2e = Boolean(process.env.STRIPE_E2E) && hasRealStripeKey;

// A real test mode payment for the order's total, so Stripe can refund it.
async function realPayment(amount: number): Promise<string> {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
  const intent = await stripe.paymentIntents.create({
    amount,
    currency: "eur",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  return intent.id;
}

test("@stripe a partial refund with restock goes through Stripe", async ({ page }) => {
  test.skip(!stripeE2e, "set STRIPE_E2E=1 with a Stripe test key");
  const socks = await seedProduct({ stock: 5, priceCents: 1000 });
  const order = await seedPaidOrder(socks, {
    quantity: 2,
    priceCents: 1000,
    paymentIntentId: await realPayment(2000),
  });
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await openOrder(page, order);

  await openByKeyboard(page, "Refund");
  await page.getByLabel(/^Units of /).fill("1");
  await page.getByRole("checkbox", { name: "Return to stock" }).check();
  await expect(page.getByLabel(/^Amount/)).toHaveValue("10.00");
  await page.getByLabel("Reason").fill("One pair returned");
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Review refund" }).click();
  await expect(dialog(page).getByText("One pair returned")).toBeVisible();
  await page.getByRole("button", { name: "Refund now" }).click();
  await expect(dialog(page)).toBeHidden({ timeout: 20_000 });

  await expect(page.getByText("Partly refunded").first()).toBeVisible();
  await expect(page.getByText("1 of 1 back to stock")).toBeVisible();
  expect(await stockOf(socks.variantId)).toBe(4);
});

test("@stripe cancelling a pending order closes its open checkout first", async ({ page }) => {
  test.skip(!stripeE2e, "set STRIPE_E2E=1 with a Stripe test key");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
  const socks = await seedProduct({ stock: 5, priceCents: 1200 });
  const order = await seedPendingOrder(await newCart(), socks, { quantity: 1, priceCents: 1200 });
  // A real open session stands in for the one startCheckout made.
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: { currency: "eur", unit_amount: 1200, product_data: { name: "Socks" } },
      },
    ],
    success_url: "http://localhost:3000/checkout/complete",
  });
  await withDb((db) =>
    db.query("UPDATE orders SET stripe_checkout_session_id = $2 WHERE id = $1", [
      order.id,
      session.id,
    ]),
  );
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await openOrder(page, order);

  await openByKeyboard(page, "Cancel order");
  await tabTo(page, page.getByLabel("Reason"));
  await page.keyboard.type("Customer ordered twice");
  await tabTo(page, dialog(page).getByRole("button", { name: "Cancel order" }));
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeHidden({ timeout: 20_000 });

  // AC-15: Stripe can no longer take the money, then the order is cancelled. Without
  // `stripe listen` no expiry event comes back, so the cancel itself writes the status.
  expect((await stripe.checkout.sessions.retrieve(session.id)).status).toBe("expired");
  await expect(page.getByText("Cancelled").first()).toBeVisible();
  await expect(history(page).getByText("Customer ordered twice")).toBeVisible();
});

test("@stripe cancelling a paid order refunds it in full", async ({ page }) => {
  test.skip(!stripeE2e, "set STRIPE_E2E=1 with a Stripe test key");
  const socks = await seedProduct({ stock: 5, priceCents: 1500 });
  const order = await seedPaidOrder(socks, {
    quantity: 1,
    priceCents: 1500,
    paymentIntentId: await realPayment(1500),
  });
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  await openOrder(page, order);

  await openByKeyboard(page, "Cancel and refund");
  await page.getByLabel("Reason").fill("Out of stock at the warehouse");
  await dialog(page).getByRole("button", { name: "Cancel and refund" }).click();
  await expect(dialog(page)).toBeHidden({ timeout: 20_000 });

  await expect(page.getByText("Fully refunded").first()).toBeVisible();
  await expect(page.getByText("Cancelled").first()).toBeVisible();
  expect(await stockOf(socks.variantId)).toBe(5);
});
