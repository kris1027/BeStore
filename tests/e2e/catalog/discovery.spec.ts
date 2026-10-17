import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations, tabTo } from "../a11y";
import { createTestUser, signInFully, withDb } from "../admin/support";
import { seedProduct, type SeededProduct } from "./support";

// spec 0013: category pages, search, filters and sort, and arranging inside a category.
//
// Rows written straight to the database never expire the cached listing index, so each test
// ends its setup with a real admin action (adding the last product to the category from its
// page), which expires the `categories` tag the index and the nav carry (AC-22).

type VariantSeed = {
  readonly color: "Red" | "Blue";
  readonly size: "S" | "M";
  readonly stock: number;
  readonly priceCents: number;
};

// A product with Color (Red, Blue) and Size (S, M) and only the given variants.
async function seedOptionsProduct(label: string, variants: readonly VariantSeed[]) {
  const product = await seedProduct({ stock: 0, label });
  return withDb(async (db) => {
    await db.query("DELETE FROM product_variants WHERE product_id = $1", [product.id]);
    const valueIds = new Map<string, string>();
    for (const [position, [name, values]] of [
      ["Color", ["Red", "Blue"]],
      ["Size", ["S", "M"]],
    ].entries()) {
      const type = await db.query<{ id: string }>(
        `INSERT INTO product_option_types (id, product_id, name, position)
         VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
        [product.id, name, position],
      );
      for (const [index, value] of (values as string[]).entries()) {
        const row = await db.query<{ id: string }>(
          `INSERT INTO product_option_values (id, option_type_id, value, position)
           VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
          [type.rows[0]!.id, value, index],
        );
        valueIds.set(value, row.rows[0]!.id);
      }
    }
    for (const [position, variant] of variants.entries()) {
      const ids = [valueIds.get(variant.color)!, valueIds.get(variant.size)!].toSorted();
      const row = await db.query<{ id: string }>(
        `INSERT INTO product_variants
           (id, product_id, sku, price_cents, stock_quantity, position, option_key, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now()) RETURNING id`,
        [
          product.id,
          `${product.slug}-${variant.color}-${variant.size}`.toUpperCase(),
          variant.priceCents,
          variant.stock,
          position,
          ids.join(","),
        ],
      );
      for (const id of ids) {
        await db.query(
          "INSERT INTO variant_option_values (variant_id, option_value_id) VALUES ($1, $2)",
          [row.rows[0]!.id, id],
        );
      }
    }
    return product;
  });
}

type Category = { readonly id: string; readonly name: string; readonly slug: string };

// A visible category holding the products in the given order, created far ahead of the others
// so its nav link is never crowded out.
async function seedCategory(products: readonly SeededProduct[], description = "") {
  const suffix = randomUUID().slice(0, 6);
  const name = `Shelf ${suffix}`;
  const slug = `shelf-${suffix}`;
  return withDb(async (db): Promise<Category> => {
    const row = await db.query<{ id: string }>(
      `INSERT INTO categories (id, name, slug, description, visible, position, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, true, -1000000 + floor(random() * 1000)::int, now())
       RETURNING id`,
      [name, slug, description || null],
    );
    const id = row.rows[0]!.id;
    for (const [position, product] of products.entries()) {
      await db.query(
        "INSERT INTO product_categories (product_id, category_id, position) VALUES ($1, $2, $3)",
        [product.id, id, position],
      );
    }
    return { id, name, slug };
  });
}

async function signIn(page: Page) {
  const admin = await createTestUser({ enrolled: true });
  await signInFully(page, admin);
}

// The admin action that expires the cached reads: add `last` from the category page.
async function addFromAdmin(page: Page, category: Category, last: SeededProduct) {
  await page.goto(`/admin/categories/${category.id}?q=${encodeURIComponent(last.name)}`);
  await page.getByRole("button", { name: `Add ${last.name}` }).click();
  await expect(
    page
      .getByRole("list", { name: "Products in this category" })
      .getByRole("link", { name: last.name }),
  ).toBeVisible();
}

async function cardNames(page: Page) {
  return page
    .getByRole("region", { name: /Products|Results|Shop all/ })
    .getByRole("heading", { level: 3 })
    .allTextContents();
}

test.describe("a category with options", () => {
  async function setup(page: Page, label: string) {
    const tag = randomUUID().slice(0, 6);
    // Red S (sold out) and Blue M: excluded by Red + M, included by Red + S without In stock.
    const mixed = await seedOptionsProduct(`${label} mixed ${tag}`, [
      { color: "Red", size: "S", stock: 0, priceCents: 1000 },
      { color: "Blue", size: "M", stock: 4, priceCents: 3000 },
    ]);
    const redM = await seedOptionsProduct(`${label} red m ${tag}`, [
      { color: "Red", size: "M", stock: 3, priceCents: 2500 },
    ]);
    const cheap = await seedOptionsProduct(`${label} cheap ${tag}`, [
      { color: "Red", size: "M", stock: 3, priceCents: 1200 },
      { color: "Blue", size: "S", stock: 3, priceCents: 1200 },
    ]);
    const category = await seedCategory([mixed, redM], "Light and cool.");
    await signIn(page);
    await addFromAdmin(page, category, cheap);
    return { mixed, redM, cheap, category };
  }

  test("a shopper opens it from the nav, filters, sorts and shares the URL", async ({
    page,
    browser,
    isMobile,
  }) => {
    const { mixed, redM, cheap, category } = await setup(page, "Happy");

    await page.goto("/");
    if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
    const link = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: category.name });
    await expect(link).toHaveAttribute("href", `/categories/${category.slug}`);
    // A long menu (local runs leave many categories) can scroll the link out of the Sheet.
    if (isMobile) await page.goto(`/categories/${category.slug}`);
    else await link.click();
    await expect(page.getByRole("heading", { level: 1, name: category.name })).toBeVisible();
    await expect(page.getByText("Light and cool.")).toBeVisible();
    // AC-1: Featured order is the category's own.
    await expect.poll(() => cardNames(page)).toEqual([mixed.name, redM.name, cheap.name]);

    if (isMobile) await page.getByRole("button", { name: "Filters" }).click();
    const panel = isMobile
      ? page.getByRole("dialog", { name: "Filters" })
      : page.getByRole("complementary");
    await panel.getByRole("checkbox", { name: /^Red/ }).check();
    await expect(page).toHaveURL(/color=red/);
    await panel.getByRole("checkbox", { name: /^M\b/ }).check();
    await expect(page).toHaveURL(/color=red&size=m/);
    if (isMobile) {
      // AC-20: the Sheet stays open while each change applies.
      await expect(panel).toBeVisible();
      await page.keyboard.press("Escape");
    }
    // AC-12: Mixed has Red only in S, so Red + M leaves it out.
    await expect(page.getByRole("status").filter({ hasText: "2 products" })).toBeVisible();

    await page.getByLabel("Sort by").selectOption("price-asc");
    await expect(page).toHaveURL(/sort=price-asc/);
    await expect.poll(() => cardNames(page)).toEqual([cheap.name, redM.name]);
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Color: Red");

    // AC-19: Back undoes the last change.
    await page.goBack();
    await expect(page).not.toHaveURL(/sort=/);

    // AC-17: the URL alone gives the same results.
    const url = `/categories/${category.slug}?sort=price-asc&color=red&size=m`;
    const other = await (await browser.newContext()).newPage();
    await other.goto(url);
    await expect.poll(() => cardNames(other)).toEqual([cheap.name, redM.name]);
  });

  test("bad params are repaired, never an error", async ({ page }) => {
    const { category } = await setup(page, "Repair");

    const response = await page.goto(
      `/categories/${category.slug}?min=50&max=10&page=999&sort=zzz&color=nope&color=red`,
    );

    expect(response?.status()).toBe(200);
    // AC-24: the canonical is the plain path, whatever the query.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/categories/${category.slug}$`),
    );
    await expect(page.getByLabel("Sort by")).toHaveValue("featured");
    const chips = page.getByRole("list", { name: "Active filters" });
    await expect(chips).toContainText("Color: Red");
    await expect(chips).toContainText("Min €10.00");
    await expect(chips).toContainText("Max €50.00");
    await expect(page.getByRole("status").filter({ hasText: /products?$/ })).toBeVisible();
  });

  // The app's bundles never load, so React never takes over: the state before hydration, or
  // after a failed download. The streamed results still show (Next reveals them with inline
  // scripts); a browser with JavaScript fully off keeps the Suspense fallback instead.
  test("without the app's JavaScript the panel is a GET form with Apply", async ({
    browser,
    page,
  }) => {
    const { category } = await setup(page, "Nojs");
    const shopper = await (await browser.newContext()).newPage();
    // Scripts only: a production build serves its CSS from chunks/ too, and an unstyled page
    // lets the fill images cover the panel.
    await shopper.route(/\/_next\/static\/chunks\/.+\.js(\?|$)/, (route) => route.abort());

    await shopper.goto(`/categories/${category.slug}`);
    await shopper
      .getByRole("form", { name: "Filters" })
      .getByRole("checkbox", { name: /^Blue/ })
      .check();
    await shopper
      .getByRole("form", { name: "Filters" })
      .getByRole("button", { name: "Apply" })
      .click();

    await expect(shopper).toHaveURL(/color=blue/);
    await expect(shopper.getByRole("list", { name: "Active filters" })).toContainText(
      "Color: Blue",
    );
  });

  test("an admin arranges the category and its Featured order follows", async ({
    page,
    browser,
    isMobile,
  }) => {
    test.skip(isMobile, "The admin keyboard arrange runs on desktop.");
    const { mixed, redM, cheap, category } = await setup(page, "Arrange");
    // setup left the admin on the category page with the three products.
    await page.reload();
    const handle = page.getByRole("button", { name: `Move ${cheap.name}`, exact: true });
    await expect(handle).toBeEnabled();
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("status").filter({ hasText: "Picked up" })).toBeAttached();
    await page.keyboard.press("ArrowUp");
    await expect(
      page.getByRole("status").filter({ hasText: "moved to position 2" }),
    ).toBeAttached();
    await page.keyboard.press("ArrowUp");
    await expect(
      page.getByRole("status").filter({ hasText: "moved to position 1" }),
    ).toBeAttached();
    await page.keyboard.press("Space");
    await expect(page.getByText("Unsaved order.")).toBeVisible();
    await page.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByText("Order saved.")).toBeVisible();

    const shopper = await (await browser.newContext()).newPage();
    await shopper.goto(`/categories/${category.slug}`);
    await expect.poll(() => cardNames(shopper)).toEqual([cheap.name, mixed.name, redM.name]);
  });

  test("hiding the category drops it from the nav and its page", async ({ page }) => {
    const { category } = await setup(page, "Hide");
    await page.goto(`/admin/categories/${category.id}`);
    await expect(page.getByRole("button", { name: "Save category" })).toBeEnabled();
    await page.getByRole("checkbox", { name: "Visible" }).click();
    await page.getByRole("button", { name: "Save category" }).click();
    await expect(page.getByText("Hidden", { exact: true })).toBeVisible();

    await page.goto(`/categories/${category.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("We can't find that page");
    await expect(page.getByRole("link", { name: category.name })).toHaveCount(0);
  });

  // verify.md, Value sourcing: the category's own fields, titles, canonicals and the count.
  test("the page reads the category's fields, titles and canonical from their sources", async ({
    page,
    browser,
    isMobile,
  }) => {
    const { category } = await setup(page, "Source");
    const shopper = await (await browser.newContext()).newPage();

    // No meta_title: the title is the name; any page or filter keeps the plain canonical.
    await shopper.goto(`/categories/${category.slug}?page=2&color=red`);
    await expect(shopper).toHaveTitle(`${category.name} · BeStore`);
    await expect(shopper.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/categories/${category.slug}$`),
    );

    // A meta_title wins; the rename and new description show on the next request.
    await withDb((db) =>
      db.query("UPDATE categories SET meta_title = $2 WHERE id = $1", [category.id, "Cool shelf"]),
    );
    const renamed = `${category.name} renamed`;
    await page.goto(`/admin/categories/${category.id}`);
    await expect(page.getByRole("button", { name: "Save category" })).toBeEnabled();
    await page.getByLabel("Name", { exact: true }).fill(renamed);
    await page.getByLabel("Description").fill("Fresh copy.");
    await page.getByRole("button", { name: "Save category" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(renamed);

    await shopper.goto(`/categories/${category.slug}`);
    await expect(shopper.getByRole("heading", { level: 1 })).toHaveText(renamed);
    await expect(shopper.getByText("Fresh copy.")).toBeVisible();
    await expect(shopper).toHaveTitle("Cool shelf · BeStore");

    await shopper.goto("/");
    await expect(shopper).toHaveTitle("BeStore");
    await shopper.goto("/search?q=shelf");
    await expect(shopper).toHaveTitle("Search · BeStore");

    // Two values, a Min and In stock: four active filters.
    await shopper.goto(`/categories/${category.slug}?color=red&color=blue&min=10&stock=1`);
    const filters = isMobile
      ? shopper.getByRole("button", { name: /^Filters/ })
      : shopper.getByRole("list", { name: "Active filters" }).getByRole("listitem");
    if (isMobile) await expect(filters).toContainText("(4)");
    else await expect(filters).toHaveCount(4);
  });

  test("home, category and search pass axe with the filters open", async ({ page, isMobile }) => {
    const { category, cheap } = await setup(page, "Axe");
    const openFilters = async () => {
      if (isMobile) await page.getByRole("button", { name: "Filters" }).click();
    };

    await page.goto("/");
    await openFilters();
    await expectNoA11yViolations(page);

    await page.goto(`/categories/${category.slug}?color=red`);
    await openFilters();
    await expectNoA11yViolations(page);

    await page.goto(`/search?q=${encodeURIComponent(cheap.name)}`);
    await openFilters();
    await expectNoA11yViolations(page);
  });

  test("the filters work by keyboard alone", async ({ page, isMobile }) => {
    test.skip(isMobile, "The keyboard pass runs on the desktop sidebar.");
    const { category } = await setup(page, "Keys");
    await page.goto(`/categories/${category.slug}`);

    const blue = page.getByRole("complementary").getByRole("checkbox", { name: /^Blue/ });
    await tabTo(page, blue);
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/color=blue/);
    // AC-19: focus stays on the box that changed.
    await expect(blue).toBeFocused();
    await expect(blue).toBeChecked();

    const min = page.getByRole("complementary").getByLabel("Min (EUR)");
    await min.focus();
    await page.keyboard.type("20");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/min=20/);
  });
});

test.describe("search", () => {
  test("the header box searches, folded and by word start, and short queries prompt", async ({
    page,
    isMobile,
  }) => {
    const tag = randomUUID().slice(0, 6);
    const church = await seedProduct({ stock: 2, label: `Kościół candle ${tag}` });
    const settee = await seedProduct({ stock: 2, label: `Settee ${tag}` });
    const category = await seedCategory([church]);
    await signIn(page);
    await addFromAdmin(page, category, settee);

    await page.goto("/");
    if (isMobile) await page.getByRole("button", { name: "Search" }).click();
    const box = page.getByRole("searchbox", { name: "Search products" }).first();
    await box.fill(`kosciol ${tag}`);
    await box.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/search\\?q=kosciol`));
    await expect(page).toHaveTitle(/^Search/);
    await expect.poll(() => cardNames(page)).toEqual([church.name]);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    // AC-24: the query never reaches the title.
    await expect(page).not.toHaveTitle(/kosciol/i);

    await page.goto(`/search?q=tee+${tag}`);
    await expect(page.getByRole("heading", { level: 2, name: "No products match." })).toBeVisible();
    await expect(page.getByText("Try fewer or shorter words")).toBeVisible();

    await page.goto("/search?q=k");
    await expect(page.getByText("Type at least 2 characters to search")).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search products" }).last()).toHaveValue("k");
  });
});
