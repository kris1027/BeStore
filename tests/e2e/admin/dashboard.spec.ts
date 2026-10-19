import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { createTestUser, signInFully, withDb } from "./support";

// spec 0015: the sales dashboard on /admin. The exact sums are proven in tests/db; here, the
// page, its links, its states and its access. Other tests write orders at the same time, so the
// figures are read from a custom range in a past year no other test touches (one per project,
// since both run in parallel), and the seeded rows are removed afterwards.

async function seedPaidOrders(year: number): Promise<string[]> {
  return withDb(async (db) => {
    const ids: string[] = [];
    for (const [day, total, quantity] of [
      ["03-02", 4000, 2],
      ["03-20", 2001, 1],
    ] as const) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO orders (id, status, email, currency, subtotal_cents, total_cents, paid_at)
         VALUES (gen_random_uuid(), 'paid', 'dashboard-e2e@example.com', 'EUR', $1, $1,
           $2::timestamptz)
         RETURNING id`,
        [total, `${year}-${day}T12:00:00Z`],
      );
      const id = rows[0]?.id ?? "";
      await db.query(
        `INSERT INTO order_lines
           (id, order_id, product_name, sku, unit_price_cents, quantity, discount_cents,
            line_total_cents)
         VALUES (gen_random_uuid(), $1, 'Dashboard e2e mug', 'E2E-MUG', $2, $3, $2 * ($3 - 1), $2)`,
        [id, total, quantity],
      );
      ids.push(id);
    }
    return ids;
  });
}

async function removeOrders(ids: readonly string[]) {
  await withDb((db) => db.query("DELETE FROM orders WHERE id = ANY($1::uuid[])", [ids]));
}

async function signedInAdmin(page: Page) {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
  return admin;
}

test("shows a period's figures, best sellers and chart table, and links to its orders", async ({
  page,
}, testInfo) => {
  const year = testInfo.project.name === "mobile" ? 2004 : 2003;
  const ids = await seedPaidOrders(year);
  try {
    await signedInAdmin(page);
    await page.goto(`/admin?from=${year}-03-01&to=${year}-03-31`);

    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    const orders = page.locator('[data-slot="card"]', {
      has: page.getByRole("heading", { name: "Orders", level: 3 }),
    });
    await expect(orders.getByText("2", { exact: true })).toBeVisible();
    await expect(page.getByText("Gross €60.01")).toBeVisible();
    await expect(page.getByText("Refunds €0.00")).toBeVisible();
    await expect(page.getByText("€30.01", { exact: true })).toBeVisible();
    await expect(page.getByText("No earlier figure to compare").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Net revenue per day" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Dashboard e2e mug 3 €60\.01/ })).toBeVisible();
    await expectNoA11yViolations(page);

    const toggle = page.getByRole("button", { name: "Show as table" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.getByRole("button", { name: "Hide table" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByRole("table", { name: /Net revenue per day/ })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByRole("link", { name: "View these orders" }).click();
    await expect(page).toHaveURL(
      `/admin/orders?status=all&dates=paid&from=${year}-03-01&to=${year}-03-31`,
    );
    await expect(page.getByRole("combobox", { name: "Date" })).toContainText("Paid");
    await expect(
      page.getByRole("row").filter({ hasText: "dashboard-e2e@example.com" }),
    ).toHaveCount(2);
  } finally {
    await removeOrders(ids);
  }
});

test("an empty period shows zeros and empty texts, with no axe violations", async ({ page }) => {
  await signedInAdmin(page);
  await page.goto("/admin?from=1999-06-01&to=1999-06-30");

  // Inside main: until Next swaps the streamed figures in, a hidden copy waits at the end of body.
  const main = page.getByRole("main");
  await expect(main.getByText("No orders", { exact: true })).toBeVisible();
  await expect(main.getByText("No products sold in this period.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Net revenue per day" })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("a range that can't be used falls back to the last 30 days with a notice", async ({
  page,
}) => {
  await signedInAdmin(page);
  await page.goto("/admin?from=2026-02-30&to=2026-03-05");

  await expect(
    page.getByText("That date range can't be used. Showing the last 30 days."),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue("30d");
});

// AC-3: the app's bundles never load, as in the storefront's no JavaScript test, so the period
// can only change through native controls.
test("without the app's JavaScript the picker still picks a preset", async ({ page }) => {
  await signedInAdmin(page);
  await page.route(/\/_next\/static\/chunks\/.+\.js(\?|$)/, (route) => route.abort());
  await page.goto("/admin?period=30d");

  const picker = page.getByRole("form", { name: "Choose a period" });
  await picker.getByLabel("Period").selectOption("7d");
  await picker.getByRole("button", { name: "Apply" }).click();

  await expect(page).toHaveURL(/period=7d/);
  await expect(picker.getByLabel("Period")).toHaveValue("7d");
});

test("the picker and the table toggle work by keyboard", async ({ page }) => {
  await signedInAdmin(page);
  await page.goto("/admin");

  const from = page.getByRole("textbox", { name: "From" });
  await tabTo(page, from);
  await page.keyboard.type("01011999");
  await page.getByRole("textbox", { name: "To", exact: true }).focus();
  await page.keyboard.type("01311999");
  await tabTo(page, page.getByRole("button", { name: "Apply" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/from=1999-01-01&to=1999-01-31/);
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveValue("");

  const toggle = page.getByRole("button", { name: "Show as table" });
  await tabTo(page, toggle);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Hide table" })).toBeFocused();
  await expect(page.getByRole("table", { name: /Net revenue per day/ })).toBeVisible();
});

test("Dashboard is the first admin nav item, current only on /admin", async ({ page }) => {
  await signedInAdmin(page);
  await page.goto("/admin");
  const nav = page.getByRole("navigation", { name: "Admin" });
  // Below md the sidebar is a sheet behind the trigger.
  if (!(await nav.isVisible())) await page.getByRole("button", { name: "Toggle Sidebar" }).click();

  const links = nav.getByRole("link");
  await expect(links.first()).toHaveText("Dashboard");
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.goto("/admin/orders");
  if (!(await nav.isVisible())) await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
});

test("the page has no horizontal scroll at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signedInAdmin(page);
  await page.goto("/admin?period=12m");
  await expect(page.getByRole("heading", { name: "Net revenue per month" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
