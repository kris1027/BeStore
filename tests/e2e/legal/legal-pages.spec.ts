import { randomUUID } from "node:crypto";

import { expect, type Page, type Request, test } from "@playwright/test";

import { expectNoA11yViolations } from "../a11y";
import { createTestUser, signInFully, withDb } from "../admin/support";
import { seedProduct } from "../catalog/support";
import {
  addToCart,
  cartIdOf,
  fillCheckout,
  hasRealStripeKey,
  payButton,
  seedPendingOrder,
  termsBox,
} from "../checkout/support";

// spec 0017: the five legal pages, the footer links, the checkout terms box and its record on
// the order, the sign up notice (AC-1 to AC-3, AC-6, AC-8 to AC-13).

const pages = [
  { path: "/terms", title: "Terms of sale", link: "Terms of sale" },
  { path: "/privacy", title: "Privacy policy", link: "Privacy policy" },
  { path: "/returns", title: "Returns", link: "Returns" },
  { path: "/shipping", title: "Shipping", link: "Shipping" },
  { path: "/cookies", title: "Cookie policy", link: "Cookie policy" },
] as const;

const siteUrl = "http://localhost:3000";

function footer(page: Page) {
  return page.getByRole("navigation", { name: "Footer" });
}

for (const legal of pages) {
  test(`${legal.path} shows its title, version date and text, and can be indexed`, async ({
    page,
  }) => {
    const response = await page.goto(legal.path);

    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBeUndefined();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(legal.title);
    await expect(page.getByText(/^Last updated \w+ \d{1,2}, \d{4}$/)).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(`^${legal.title} · `));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${siteUrl}${legal.path}`,
    );
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\w/);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    // No placeholder ever reaches the page.
    await expect(page.locator("main")).not.toContainText("{{");
    await expectNoA11yViolations(page);
  });
}

test("every store footer links the legal pages in order, then Cookie settings", async ({
  page,
}) => {
  for (const path of ["/", "/cart", "/no-such-page-here"]) {
    await page.goto(path);
    const links = footer(page).getByRole("listitem");
    await expect(links).toHaveText([...pages.map((legal) => legal.link), "Cookie settings"]);
  }

  await page.goto("/");
  await footer(page).getByRole("link", { name: "Returns" }).click();
  await expect(page).toHaveURL("/returns");
  await expect(page.getByRole("heading", { level: 1, name: "Returns" })).toBeVisible();
});

test("the returns page ends with the model withdrawal form", async ({ page }) => {
  await page.goto("/returns");

  const heading = page.getByRole("heading", { level: 2, name: "Model withdrawal form" });
  await expect(heading).toBeVisible();
  await expect(page.locator("main blockquote")).toContainText("I/We (*) hereby give notice");
  await expect(page.getByText(/You can print it, or copy it into an email to/)).toBeVisible();
});

test("printing a legal page prints only its text", async ({ page }) => {
  await page.goto("/terms");
  await page.emulateMedia({ media: "print" });

  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("contentinfo")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Terms of sale" })).toBeVisible();
});

test("the admin panel shows no legal footer and no consent banner", async ({ page }) => {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(footer(page)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Terms of sale" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
});

test("sign up says the terms and privacy policy apply, with links that open a new tab", async ({
  page,
}) => {
  await page.goto("/account/sign-up");

  await expect(
    page.getByText("By creating an account you accept the terms of sale and confirm"),
  ).toBeVisible();
  const terms = page.getByRole("link", { name: "terms of sale, opens in a new tab" });
  await expect(terms).toHaveAttribute("href", "/terms");
  await expect(terms).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "privacy policy, opens in a new tab" }),
  ).toHaveAttribute("href", "/privacy");
});

// The server action Pay calls: a POST to /checkout carrying the Next-Action header.
function isPay(request: Request): boolean {
  return request.method() === "POST" && request.headers()["next-action"] !== undefined;
}

test.describe("the checkout terms box", () => {
  test.beforeEach(async ({ page }) => {
    const socks = await seedProduct({ stock: 5, priceCents: 1250 });
    await addToCart(page, socks);
    await page.goto("/checkout");
  });

  test("is unticked, links the texts in a new tab, and Pay without it sends nothing", async ({
    page,
  }) => {
    await expect(termsBox(page)).not.toBeChecked();
    for (const name of [
      "terms of sale, opens in a new tab",
      "privacy policy, opens in a new tab",
      "returns, opens in a new tab",
      "shipping, opens in a new tab",
    ]) {
      await expect(page.getByRole("link", { name })).toHaveAttribute("target", "_blank");
    }

    await fillCheckout(page);
    await termsBox(page).uncheck();
    const sent: Request[] = [];
    page.on("request", (request) => {
      if (isPay(request)) sent.push(request);
    });
    await expect(payButton(page)).toBeEnabled();
    await payButton(page).click();

    await expect(page.getByText("Tick the box to accept the terms of sale.")).toBeVisible();
    await expect(termsBox(page)).toBeFocused();
    await expect(termsBox(page)).toHaveAttribute("aria-invalid", "true");
    await expect(payButton(page)).toBeEnabled();
    expect(sent).toEqual([]);
    await expectNoA11yViolations(page);
  });

  test("asks again when the terms changed since the page loaded, keeping every field", async ({
    page,
  }) => {
    // Unique per run: the local database keeps orders from earlier runs.
    const email = `terms.changed.${randomUUID()}@example.com`;
    await fillCheckout(page, email);
    // Stand in for terms that changed after this page loaded: the first Pay carries an old
    // version, as a page loaded before the change would.
    let first = true;
    await page.route("**/checkout", async (route) => {
      const request = route.request();
      if (!isPay(request) || !first) return route.continue();
      first = false;
      const body = request.postData() ?? "";
      expect(body).toMatch(/"termsVersion":"\d{4}-\d{2}-\d{2}"/);
      await route.continue({
        postData: body.replace(/"termsVersion":"[^"]*"/, '"termsVersion":"2020-01-01"'),
      });
    });

    await payButton(page).click();

    const alert = page.getByRole("alert").filter({ hasText: "Our terms of sale changed on" });
    await expect(alert).toContainText(/changed on \w+ \d{1,2}, \d{4}\. Please read them/);
    await expect(alert.getByRole("link", { name: "them, opens in a new tab" })).toHaveAttribute(
      "href",
      "/terms",
    );
    await expect(termsBox(page)).not.toBeChecked();
    await expect(termsBox(page)).toBeFocused();
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("City")).toHaveValue("Warsaw");
    expect(
      await withDb((db) => db.query("SELECT 1 FROM orders WHERE email = $1", [email])).then(
        (r) => r.rowCount,
      ),
    ).toBe(0);
    await expectNoA11yViolations(page);

    // The next Pay with the box ticked sends the current version.
    await termsBox(page).check();
    const retry = page.waitForRequest(isPay);
    await payButton(page).click();
    expect((await retry).postData()).not.toContain('"termsVersion":"2020-01-01"');
    await expect(alert).toHaveCount(0);
  });
});

test("a ticked Pay records the terms version on the order, shown to the admin", async ({
  page,
  browser,
}) => {
  test.skip(!hasRealStripeKey, "needs a real Stripe test key (STRIPE_SECRET_KEY)");
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  await page.goto("/checkout");
  const email = `terms.accepted.${randomUUID()}@example.com`;
  await fillCheckout(page, email);
  await payButton(page).click();
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\//, { timeout: 30_000 });

  const row = await withDb((db) =>
    db.query<{ number: number; version: string; accepted: boolean }>(
      `SELECT number, terms_version::text AS version, terms_accepted_at IS NOT NULL AS accepted
       FROM orders WHERE email = $1`,
      [email],
    ),
  );
  expect(row.rows[0]).toMatchObject({
    version: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    accepted: true,
  });

  const admin = await createTestUser({ enrolled: true });
  const adminPage = await (await browser.newContext()).newPage();
  await signInFully(adminPage, admin);
  await adminPage.goto(`/admin/orders/${row.rows[0]!.number}`);
  await expect(adminPage.getByText(/^version \w+ \d{1,2}, \d{4}, on /)).toBeVisible();
});

test("an order from before the feature reads 'not recorded' on the admin page", async ({
  page,
  browser,
}) => {
  const socks = await seedProduct({ stock: 5, priceCents: 1250 });
  await addToCart(page, socks);
  const order = await seedPendingOrder(await cartIdOf(page), socks, {
    quantity: 1,
    priceCents: 1250,
  });

  const admin = await createTestUser({ enrolled: true });
  const adminPage = await (await browser.newContext()).newPage();
  await signInFully(adminPage, admin);
  await adminPage.goto(`/admin/orders/${order.number}`);
  const details = adminPage.locator("dl").filter({ hasText: "Terms accepted" });
  await expect(details.getByText("not recorded")).toBeVisible();

  await withDb((db) =>
    db.query(
      `UPDATE orders SET terms_version = '2026-10-20', terms_accepted_at = '2026-10-20T21:30:00Z'
       WHERE id = $1`,
      [order.id],
    ),
  );
  await adminPage.reload();
  // The version is a calendar day; the acceptance time is in the store's time zone.
  await expect(details.getByText(/^version October 20, 2026, on Oct 2[01], 2026/)).toBeVisible();
});
