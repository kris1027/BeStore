import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { withDb } from "../admin/support";
import { seedProduct } from "../catalog/support";
import {
  addToCart,
  cartIdOf,
  fillCheckout,
  hasRealStripeKey,
  payButton,
  seedCode,
  seedPaidOrderWithCode,
  seedPendingOrder,
  setCodeActive,
} from "./support";

// spec 0014, AC-1, AC-3, AC-4, AC-9, AC-15 and AC-20: the promo code on /checkout. Delivery
// comes from the shared store_settings row, so these assert the discount row and that the Pay
// button carries the shown total, never a delivery amount.

function codeField(page: Page) {
  return page.getByRole("textbox", { name: "Promo code" });
}

async function applyCode(page: Page, text: string) {
  await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();
  await codeField(page).fill(text);
  await page.getByRole("button", { name: "Apply" }).click();
}

// The Pay button says the same total as the summary.
async function expectPayMatchesTotal(page: Page) {
  const total = await page
    .getByText("Total", { exact: true })
    .locator("xpath=following-sibling::*[1]")
    .innerText();
  await expect(payButton(page)).toHaveText(`Pay ${total}`);
}

async function openCheckoutWith(page: Page, priceCents: number, quantity = 1) {
  const product = await seedProduct({ stock: 9, priceCents });
  await addToCart(page, product, quantity);
  await page.goto("/checkout");
  return product;
}

test("a valid code lowers the total before payment, and Remove takes it off", async ({ page }) => {
  const { code } = await seedCode({ value: 10 });
  await openCheckoutWith(page, 2500, 2);

  await applyCode(page, ` ${code.toLowerCase()} `);

  await expect(page.getByText(`Discount (${code})`)).toBeVisible();
  await expect(page.getByText("−€5.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: `Code ${code} applied` })).toBeAttached();
  await expectPayMatchesTotal(page);
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(`Discount (${code})`)).toHaveCount(0);
  await expect(codeField(page)).toBeFocused();
  await expect(codeField(page)).toHaveValue("");
  await expectPayMatchesTotal(page);
});

test("Enter in the code field runs Apply, never Pay, by keyboard alone", async ({ page }) => {
  const { code } = await seedCode({ type: "fixed_amount", value: 300 });
  await openCheckoutWith(page, 2000);
  await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();

  await tabTo(page, codeField(page));
  await page.keyboard.type(code);
  await page.keyboard.press("Enter");

  await expect(page.getByText(`Discount (${code})`)).toBeVisible();
  await expect(page.getByText("−€3.00")).toBeVisible();
  await expect(page).toHaveURL("/checkout");
  // The payment form was never submitted: its fields show no errors.
  await expect(page.getByText("Enter a valid email address.")).toHaveCount(0);
});

test("each refusal shows its message under the field and keeps focus there", async ({ page }) => {
  const expired = await seedCode({ endsAt: new Date(Date.now() - 60_000) });
  const minimum = await seedCode({ minSubtotalCents: 5000 });
  await openCheckoutWith(page, 2000);

  for (const [text, message] of [
    ["NO-SUCH-CODE", "This code isn't valid."],
    ["10% off", "This code isn't valid."],
    [expired.code, "This code has expired."],
    [minimum.code, "Add €30.00 more to use this code."],
  ] as const) {
    await applyCode(page, text);
    const error = page.locator("#checkout-discount-code-error");
    await expect(error).toHaveText(message);
    await expect(codeField(page)).toHaveAttribute(
      "aria-describedby",
      "checkout-discount-code-error",
    );
    await expect(codeField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(codeField(page)).toBeFocused();
    await expect(page.getByText(/^Discount \(/)).toHaveCount(0);
  }
  await expectNoA11yViolations(page);
});

test("Pay refuses a code switched off after Apply, keeping the form", async ({ page }) => {
  const seeded = await seedCode();
  await openCheckoutWith(page, 2000);
  await applyCode(page, seeded.code);
  await expect(page.getByText(`Discount (${seeded.code})`)).toBeVisible();
  await setCodeActive(seeded.id, false);

  await fillCheckout(page);
  await payButton(page).click();

  await expect(page.locator("#checkout-discount-code-error")).toHaveText("This code isn't valid.");
  await expect(codeField(page)).toBeFocused();
  await expect(page.getByText(`Discount (${seeded.code})`)).toHaveCount(0);
  await expect(page.getByLabel("Full name")).toHaveValue("Anna Kowalska");
  await expect(page).toHaveURL("/checkout");
  const orders = await withDb(async (db) =>
    db.query("SELECT 1 FROM orders WHERE cart_id = $1", [await cartIdOf(page)]),
  );
  expect(orders.rowCount).toBe(0);
});

test("Pay refusing a code that came back applied keeps its text in the field", async ({ page }) => {
  const seeded = await seedCode();
  const product = await openCheckoutWith(page, 2000);
  // The expired order an earlier Pay left behind (AC-9), so no Stripe session is involved.
  const earlier = await seedPendingOrder(await cartIdOf(page), product, {
    quantity: 1,
    priceCents: 2000,
    shippingCents: 0,
  });
  await withDb((db) =>
    db.query(
      `UPDATE orders SET status = 'expired', expired_at = now(), discount_code_id = $2,
         discount_code = $3, discount_type = 'percent', discount_value = 10
       WHERE id = $1`,
      [earlier.id, seeded.id, seeded.code],
    ),
  );
  await page.goto("/checkout");
  await expect(page.getByText(`Discount (${seeded.code})`)).toBeVisible();
  await setCodeActive(seeded.id, false);

  await fillCheckout(page);
  await payButton(page).click();

  await expect(page.locator("#checkout-discount-code-error")).toHaveText("This code isn't valid.");
  await expect(codeField(page)).toHaveValue(seeded.code);
});

test("Pay with a code reaches Stripe, and coming back shows the code still applied", async ({
  page,
}) => {
  test.skip(!hasRealStripeKey, "needs a real Stripe test key (STRIPE_SECRET_KEY)");
  const { code } = await seedCode({ value: 20 });
  await openCheckoutWith(page, 2500);
  await applyCode(page, code);
  await expect(page.getByText(`Discount (${code})`)).toBeVisible();
  await fillCheckout(page);
  await payButton(page).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });

  const order = await withDb(async (db) =>
    db.query<{ discount_code: string; discount_cents: number }>(
      "SELECT discount_code, discount_cents FROM orders WHERE cart_id = $1",
      [await cartIdOf(page)],
    ),
  );
  expect(order.rows).toEqual([{ discount_code: code, discount_cents: 500 }]);

  await page.goto("/checkout?cancelled=1");
  await expect(page.getByText(`Discount (${code})`)).toBeVisible();
  await expect(codeField(page)).toHaveValue(code);
  await expectPayMatchesTotal(page);
});

test("the confirmation page names the code on the discount row", async ({ page }) => {
  const product = await seedProduct({ stock: 5, priceCents: 4000 });
  const code = await seedCode({ value: 25 });
  const order = await seedPaidOrderWithCode(product, code, {
    priceCents: 4000,
    discountCents: 1000,
  });

  await page.goto(`/checkout/complete?session_id=${order.sessionId}`);

  await expect(page.getByText(`Discount (${code.code})`)).toBeVisible();
  await expect(page.getByText("−€10.00")).toBeVisible();
  // Disabled until hydration, and a disabled button is drawn too faint for axe.
  await expect(
    page.getByRole("button", { name: "Create an account to track this order" }),
  ).toBeEnabled();
  await expect(page.getByText("€30.00").last()).toBeVisible();
  await expectNoA11yViolations(page);
});
