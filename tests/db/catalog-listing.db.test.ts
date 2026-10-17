import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createProductWithOptions, createSimpleProduct, createVariant } from "./fixtures";

// The storefront discovery reads against a real Postgres (spec 0013): the cached listing index
// (AC-2, AC-22) and the category reads (AC-2, AC-3).

const mocks = vi.hoisted(() => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" } }));
vi.mock("next/cache", () => ({ cacheTag: mocks.cacheTag, cacheLife: mocks.cacheLife }));

const { getListingIndex } = await import("@/features/catalog/listing/index-query");
const { buildListing } = await import("@/features/catalog/listing/listing");
const { parseListingParams } = await import("@/features/catalog/listing/params");
const { getCategoryBySlug, getNavCategories, getPrerenderedCategorySlugs } =
  await import("@/features/categories/queries");

resetDatabaseBeforeEach();

beforeEach(() => vi.clearAllMocks());

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute));

// A listable product: active with one live variant.
async function listed(
  slug: string,
  data: Partial<{
    status: "draft" | "active" | "archived";
    position: number;
    createdAt: Date;
  }> = {},
  variant: Partial<{ priceCents: number; stockQuantity: number }> = {},
) {
  const product = await testDb.product.create({
    data: { name: slug, slug, status: "active", ...data },
  });
  await createVariant(product.id, { sku: `SKU-${slug}`, ...variant });
  return product;
}

async function homeCards() {
  const listing = buildListing(
    await getListingIndex(),
    { kind: "home" },
    parseListingParams({}, "home", "EUR"),
    "en",
  );
  if (listing.status !== "ok") throw new Error("home never prompts");
  return listing.products;
}

describe("getListingIndex", () => {
  it("holds only active products with a live variant, and is tagged catalog and categories", async () => {
    await listed("old-first", { position: 0, createdAt: at(1) });
    await listed("new-first", { position: 0, createdAt: at(2) });
    await listed("later", { position: 1, createdAt: at(3) });
    await listed("a-draft", { status: "draft", createdAt: at(4) });
    await listed("archived", { status: "archived", createdAt: at(5) });
    await testDb.product.create({ data: { name: "bare", slug: "bare", status: "active" } });
    const gone = await listed("only-archived-variants");
    await testDb.productVariant.updateMany({
      where: { productId: gone.id },
      data: { archived: true },
    });

    expect((await homeCards()).map((card) => card.slug)).toEqual([
      "new-first",
      "old-first",
      "later",
    ]);
    expect(mocks.cacheTag).toHaveBeenCalledWith("catalog", "categories");
    expect(mocks.cacheLife).toHaveBeenCalledWith("max");
  });

  it("has no paging cap: every listable product is in the index", async () => {
    for (let i = 0; i < 50; i += 1) await listed(`p-${i}`);

    expect(await getListingIndex()).toHaveLength(50);
  });

  it("keeps stock only as a boolean, never the count", async () => {
    const shirt = await listed("shirt", {}, { stockQuantity: 12 });
    await createVariant(shirt.id, { sku: "B", stockQuantity: 0, optionKey: "b", position: 1 });

    const [entry] = await getListingIndex();

    expect(entry?.variants.map((variant) => variant.inStock)).toEqual([true, false]);
    for (const variant of entry?.variants ?? []) {
      expect(Object.keys(variant).toSorted()).toEqual([
        "compareAtPriceCents",
        "inStock",
        "priceCents",
        "valueIndexes",
      ]);
    }
  });

  it("gives the card price range over live variants, ignoring archived ones", async () => {
    const shirt = await listed("shirt", {}, { priceCents: 1500 });
    await createVariant(shirt.id, { sku: "B", priceCents: 2500, optionKey: "b" });
    const archived = await createVariant(shirt.id, { sku: "C", priceCents: 100, optionKey: "c" });
    await testDb.productVariant.update({ where: { id: archived.id }, data: { archived: true } });

    const [card] = await homeCards();

    expect(card).toMatchObject({ minPriceCents: 1500, maxPriceCents: 2500, soldOut: false });
  });

  it("is sold out only when every live variant has no stock, and on sale only in stock", async () => {
    await createSimpleProduct("gone", 0);
    await createSimpleProduct("left", 1);
    const sale = await listed("sale", {}, { stockQuantity: 2 });
    const soldOutSale = await listed("sold-out-sale", {}, { stockQuantity: 0 });
    await testDb.productVariant.updateMany({
      where: { productId: { in: [sale.id, soldOutSale.id] } },
      data: { compareAtPriceCents: 4000 },
    });

    const cards = new Map((await homeCards()).map((card) => [card.slug, card]));

    expect(cards.get("tee-gone")?.soldOut).toBe(true);
    expect(cards.get("tee-left")?.soldOut).toBe(false);
    expect(cards.get("sale")?.onSale).toBe(true);
    expect(cards.get("sold-out-sale")).toMatchObject({ onSale: false, soldOut: true });
  });

  it("shows the first image by position, or the decorative placeholder", async () => {
    const withImage = await listed("with-image", { createdAt: at(2) });
    await listed("without-image", { createdAt: at(1) });
    await testDb.productImage.createMany({
      data: [
        {
          productId: withImage.id,
          storagePath: "products/second.png",
          altText: "Back",
          position: 1,
        },
        {
          productId: withImage.id,
          storagePath: "products/first.png",
          altText: "Front",
          position: 0,
          width: 800,
          height: 1000,
        },
      ],
    });

    const [first, second] = await homeCards();

    expect(first?.image).toEqual({
      src: "http://127.0.0.1:55321/storage/v1/object/public/product-images/products/first.png",
      alt: "Front",
      width: 800,
      height: 1000,
    });
    expect(second?.image).toEqual({ src: "/placeholder.svg", alt: "", width: null, height: null });
  });

  it("carries option values per variant and the category positions", async () => {
    const { product, variants } = await createProductWithOptions("tee");
    const category = await testDb.category.create({
      data: { name: "Tees", slug: "tees", position: 0 },
    });
    await testDb.productCategory.create({
      data: { productId: product.id, categoryId: category.id, position: 7 },
    });

    const [entry] = await getListingIndex();

    expect(entry?.categoryPositions).toEqual({ [category.id]: 7 });
    expect(entry?.optionTypes).toEqual([
      {
        key: "size",
        label: "Size",
        values: [
          { key: "s", label: "S" },
          { key: "m", label: "M" },
        ],
      },
      {
        key: "color",
        label: "Color",
        values: [
          { key: "red", label: "Red" },
          { key: "blue", label: "Blue" },
        ],
      },
    ]);
    // S Red, S Blue, M Red, M Blue: each variant points at its size and colour.
    expect(entry?.variants.map((variant) => variant.valueIndexes.toSorted())).toEqual([
      [
        [0, 0],
        [1, 0],
      ],
      [
        [0, 0],
        [1, 1],
      ],
      [
        [0, 1],
        [1, 0],
      ],
      [
        [0, 1],
        [1, 1],
      ],
    ]);
    expect(variants).toHaveLength(4);
  });

  it("stays well under the cache entry limit at 500 products", async () => {
    const products = Array.from({ length: 500 }, (_, i) => ({
      name: `Linen shirt number ${i}`,
      slug: `linen-${i}`,
      status: "active" as const,
    }));
    await testDb.product.createMany({ data: products });
    const rows = await testDb.product.findMany({ select: { id: true } });
    for (const row of rows) {
      const size = await testDb.productOptionType.create({
        data: {
          productId: row.id,
          name: "Size",
          position: 0,
          values: {
            create: ["XS", "S", "M", "L", "XL"].map((value, position) => ({ value, position })),
          },
        },
        include: { values: true },
      });
      await testDb.productVariant.createMany({
        data: size.values.map((value, position) => ({
          productId: row.id,
          sku: `SKU-${row.id}-${value.value}`,
          priceCents: 3000 + position * 100,
          stockQuantity: 3,
          position,
          optionKey: value.id,
        })),
      });
      const variantRows = await testDb.productVariant.findMany({
        where: { productId: row.id },
        select: { id: true, optionKey: true },
      });
      await testDb.variantOptionValue.createMany({
        data: variantRows.map((variant) => ({
          variantId: variant.id,
          optionValueId: variant.optionKey,
        })),
      });
    }

    const index = await getListingIndex();

    expect(index).toHaveLength(500);
    // Next's cache entries go up to 2 MB; keep a wide margin.
    expect(new TextEncoder().encode(JSON.stringify(index)).length).toBeLessThan(1_000_000);
  }, 120_000);
});

describe("category reads", () => {
  async function category(slug: string, position: number, visible = true) {
    return testDb.category.create({
      data: {
        name: `Cat ${slug}`,
        slug,
        position,
        visible,
        description: "Light and cool.",
        metaTitle: slug === "linen" ? "Linen shirts" : null,
      },
    });
  }

  it("lists visible categories in admin order for the nav, tagged categories", async () => {
    await category("wool", 1);
    await category("linen", 0);
    await category("hidden", 2, false);

    expect(await getNavCategories()).toEqual([
      { name: "Cat linen", slug: "linen" },
      { name: "Cat wool", slug: "wool" },
    ]);
    expect(await getPrerenderedCategorySlugs()).toEqual(["linen", "wool"]);
    expect(mocks.cacheTag).toHaveBeenCalledWith("categories");
  });

  it("finds a visible category by slug, and null for unknown, malformed or hidden", async () => {
    const linen = await category("linen", 0);
    await category("hidden", 1, false);

    expect(await getCategoryBySlug("linen")).toEqual({
      id: linen.id,
      name: "Cat linen",
      slug: "linen",
      description: "Light and cool.",
      metaTitle: "Linen shirts",
      metaDescription: null,
    });
    expect(await getCategoryBySlug("hidden")).toBeNull();
    expect(await getCategoryBySlug("nope")).toBeNull();
    expect(await getCategoryBySlug("Not A Slug")).toBeNull();
    expect(mocks.cacheTag).toHaveBeenCalledWith("categories");
  });
});
