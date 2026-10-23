import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { brand } from "../../../src/lib/brand/brand";
import { createTestUser, signInFully, withDb } from "../admin/support";
import {
  type SeededProduct,
  seedProduct,
  setProductStatus,
  waitForEditor,
} from "../catalog/support";

// spec 0018: what a crawler reads. Next blocks on metadata for known bots and puts it in the
// head; for other browsers it may stream in later, so every test here reads as Googlebot.
const googlebot = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
test.use({ userAgent: googlebot });

const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").origin;
const brandCard = `${siteUrl}/brand-card.png`;

async function meta(page: Page, attribute: "name" | "property", key: string) {
  const tag = page.locator(`meta[${attribute}="${key}"]`);
  return (await tag.count()) === 0 ? null : tag.first().getAttribute("content");
}

async function canonical(page: Page) {
  const link = page.locator('link[rel="canonical"]');
  return (await link.count()) === 0 ? null : link.first().getAttribute("href");
}

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
  return scripts.flatMap((text) => {
    const data: unknown = JSON.parse(text);
    return (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
  });
}

// A second variant, sold out and on sale ("Was" above its price).
async function addSaleVariant(product: SeededProduct) {
  await withDb((db) =>
    db.query(
      `INSERT INTO product_variants
         (id, product_id, sku, price_cents, compare_at_price_cents, stock_quantity, position,
          option_key, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 1000, 1500, 0, 1, 'b', now())`,
      [product.id, `SALE-${randomUUID().slice(0, 8).toUpperCase()}`],
    ),
  );
}

test.describe("a product page", () => {
  test("has its own metadata, the brand card and Product data with one Offer per variant", async ({
    page,
  }) => {
    const product = await seedProduct({ stock: 9, priceCents: 12900, label: "Seo scarf" });
    await addSaleVariant(product);
    await withDb((db) =>
      db.query("UPDATE products SET description = $2 WHERE id = $1", [
        product.id,
        "A **warm** scarf, knitted [by hand](https://example.com).",
      ]),
    );
    const url = `${siteUrl}/products/${product.slug}`;

    await page.goto(`/products/${product.slug}`);

    await expect(page).toHaveTitle(`${product.name} · ${brand.name}`);
    expect(await meta(page, "name", "description")).toBe("A warm scarf, knitted by hand.");
    expect(await canonical(page)).toBe(url);
    expect(await meta(page, "property", "og:url")).toBe(url);
    expect(await meta(page, "property", "og:site_name")).toBe(brand.name);
    expect(await meta(page, "property", "og:image")).toBe(brandCard);
    expect(await meta(page, "property", "og:image:alt")).toBe(brand.name);
    expect(await meta(page, "name", "twitter:card")).toBe("summary_large_image");
    expect(await meta(page, "name", "twitter:image")).toBe(brandCard);

    const [data] = (await jsonLd(page)).filter((item) => item["@type"] === "Product");
    expect(data).toMatchObject({
      name: product.name,
      description: "A warm scarf, knitted by hand.",
      url,
      brand: { "@type": "Brand", name: brand.name },
      offers: [
        {
          price: "129.00",
          availability: "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
        },
        {
          price: "10.00",
          availability: "https://schema.org/OutOfStock",
          priceSpecification: {
            priceType: "https://schema.org/StrikethroughPrice",
            price: "15.00",
          },
        },
      ],
    });
    expect(data).not.toHaveProperty("image");
    expect(JSON.stringify(data)).not.toMatch(/inventoryLevel|"left"/);
  });

  test("keeps a name holding a script tag inert in the JSON-LD", async ({ page }) => {
    const product = await seedProduct({
      stock: 3,
      label: "Seo </script><script>window.pwned=1</script>",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`/products/${product.slug}`);

    const [data] = (await jsonLd(page)).filter((item) => item["@type"] === "Product");
    expect(data?.name).toBe(product.name);
    expect(await page.evaluate(() => "pwned" in window)).toBe(false);
    expect(errors).toEqual([]);
  });

  test("a draft renders the not found page, noindex, with no product data", async ({ page }) => {
    const product = await seedProduct({ stock: 3, label: "Seo draft" });
    await setProductStatus(product.id, "draft");

    await page.goto(`/products/${product.slug}`);

    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
    expect(await meta(page, "name", "robots")).toContain("noindex");
    expect(await jsonLd(page)).toEqual([]);
    expect(await canonical(page)).toBeNull();
  });
});

test.describe("listings", () => {
  test("home declares the Organization and WebSite and canonicalizes by the parsed state", async ({
    page,
  }) => {
    await page.goto("/?page=abc&utm_source=x");

    await expect(page).toHaveTitle(brand.name);
    // Next writes the root canonical without its trailing slash.
    expect(await canonical(page)).toBe(siteUrl);
    expect(await meta(page, "property", "og:image")).toBe(brandCard);
    const data = await jsonLd(page);
    expect(data).toContainEqual(
      expect.objectContaining({
        "@type": "Organization",
        name: brand.name,
        logo: `${siteUrl}/logo.png`,
      }),
    );
    expect(data).toContainEqual(expect.objectContaining({ "@type": "WebSite", name: brand.name }));
    expect(JSON.stringify(data)).not.toContain("SearchAction");

    await page.goto("/?sort=price-asc&page=2");
    expect(await canonical(page)).toBe(siteUrl);
  });

  test("a category has its canonical, description and breadcrumb; a hidden one has none", async ({
    page,
  }) => {
    const suffix = randomUUID().slice(0, 6);
    const slug = `seo-shelf-${suffix}`;
    await withDb((db) =>
      db.query(
        `INSERT INTO categories (id, name, slug, description, visible, position, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, true, 1000000, now()),
                (gen_random_uuid(), $4, $5, null, false, 1000001, now())`,
        [`Seo shelf ${suffix}`, slug, "Light and **cool**.", `Hidden ${suffix}`, `${slug}-hidden`],
      ),
    );

    await page.goto(`/categories/${slug}?color=red&min=1`);

    await expect(page).toHaveTitle(`Seo shelf ${suffix} · ${brand.name}`);
    expect(await canonical(page)).toBe(`${siteUrl}/categories/${slug}`);
    expect(await meta(page, "name", "description")).toBe("Light and cool.");
    const [crumbs] = (await jsonLd(page)).filter((item) => item["@type"] === "BreadcrumbList");
    expect(crumbs?.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: brand.name, item: `${siteUrl}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: `Seo shelf ${suffix}`,
        item: `${siteUrl}/categories/${slug}`,
      },
    ]);
    // No filter text anywhere in the metadata (spec 0013, AC-24).
    expect(await page.locator("head").innerHTML()).not.toContain("color=red");

    await page.goto(`/categories/${slug}-hidden`);
    await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
    expect(await meta(page, "name", "robots")).toContain("noindex");
    expect(await jsonLd(page)).toEqual([]);
  });

  test("search stays noindex, follow with the brand card and no canonical", async ({ page }) => {
    await page.goto("/search?q=scarf");

    expect(await meta(page, "name", "robots")).toBe("noindex, follow");
    expect(await canonical(page)).toBeNull();
    expect(await meta(page, "property", "og:image")).toBe(brandCard);
    expect(await jsonLd(page)).toEqual([]);
    expect(await page.title()).not.toContain("scarf");
  });

  test("a legal page has its canonical and the brand card", async ({ page }) => {
    await page.goto("/terms");

    expect(await canonical(page)).toBe(`${siteUrl}/terms`);
    expect(await meta(page, "property", "og:image")).toBe(brandCard);
  });
});

test.describe("site files", () => {
  test("robots.txt blocks every crawler outside production", async ({ request }) => {
    const response = await request.get("/robots.txt");

    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toMatch(/User-Agent: \*\s+Disallow: \/\s*$/i);
    expect(text).not.toContain("Sitemap");
  });

  test("the brand card and logo are PNGs at their fixed paths", async ({ request }) => {
    for (const path of ["/brand-card.png", "/logo.png"]) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
    }
  });

  test("the sitemap follows a publish and a hide on the next request", async ({
    page,
    request,
    browser,
  }) => {
    const product = await seedProduct({ stock: 2, label: "Seo map" });
    await setProductStatus(product.id, "draft");
    const url = `${siteUrl}/products/${product.slug}`;
    const sitemap = async () => (await request.get("/sitemap.xml")).text();

    const before = await sitemap();
    expect(before).not.toContain(url);
    expect(before).toContain(`<loc>${siteUrl}/</loc>`);
    expect(before).toContain(`<loc>${siteUrl}/terms</loc>`);
    expect(before).not.toMatch(/\/(search|admin|cart|checkout|account|auth)\b/);

    const admin = await createTestUser({ enrolled: true });
    await signInFully(page, admin);
    await page.goto(`/admin/products/${product.id}`);
    await waitForEditor(page, product.name);
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Product published")).toBeVisible();
    await expect.poll(sitemap).toContain(`<loc>${url}</loc>`);

    // Rendered and cached while live, so the hide below is a request time miss (AC-21).
    const customer = await (await browser.newContext({ userAgent: googlebot })).newPage();
    await customer.goto(`/products/${product.slug}`);
    expect(await jsonLd(customer)).not.toEqual([]);

    await page.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByText("Product hidden")).toBeVisible();
    await expect.poll(sitemap).not.toContain(url);
    await customer.goto(`/products/${product.slug}`);
    await expect(customer.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
    expect(await meta(customer, "name", "robots")).toContain("noindex");
    expect(await jsonLd(customer)).toEqual([]);
  });

  // AC-22: the private pages keep their noindex and gain nothing.
  for (const path of [
    "/cart",
    "/checkout",
    "/account/sign-in",
    "/account/sign-up",
    "/admin/sign-in",
  ]) {
    test(`${path} stays noindex with no canonical or JSON-LD`, async ({ page }) => {
      await page.goto(path);

      expect(await meta(page, "name", "robots")).toContain("noindex");
      expect(await canonical(page)).toBeNull();
      expect(await jsonLd(page)).toEqual([]);
    });
  }
});
