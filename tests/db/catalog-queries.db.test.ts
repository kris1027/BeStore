import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createProductWithOptions, createSimpleProduct, createVariant } from "./fixtures";

// The catalog reads against a real Postgres: the home grid (AC-6), the product page view
// (AC-7), their cache tags (AC-14) and the admin list (AC-1).

const mocks = vi.hoisted(() => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" } }));
vi.mock("next/cache", () => ({ cacheTag: mocks.cacheTag, cacheLife: mocks.cacheLife }));

const { getActiveProducts, getPrerenderedSlugs, getProductBySlug, HOME_PRODUCT_LIMIT } =
  await import("@/features/catalog/queries");
const { ADMIN_PRODUCT_LIMIT, getAdminProducts } = await import("@/features/catalog/admin-queries");

resetDatabaseBeforeEach();

beforeEach(() => vi.clearAllMocks());

const at = (minute: number) => new Date(Date.UTC(2026, 8, 1, 12, minute));

async function product(
  slug: string,
  data: Partial<{ status: "draft" | "active" | "archived"; position: number; createdAt: Date }>,
) {
  return testDb.product.create({ data: { name: slug, slug, status: "active", ...data } });
}

describe("getActiveProducts", () => {
  it("lists active products by position, then newest first, and tags the list", async () => {
    await product("old-first", { position: 0, createdAt: at(1) });
    await product("new-first", { position: 0, createdAt: at(2) });
    await product("later", { position: 1, createdAt: at(3) });
    await product("a-draft", { status: "draft", createdAt: at(4) });
    await product("archived", { status: "archived", createdAt: at(5) });

    const cards = await getActiveProducts();

    expect(cards.map((card) => card.slug)).toEqual(["new-first", "old-first", "later"]);
    expect(mocks.cacheTag).toHaveBeenCalledWith("catalog");
  });

  it(`stops at ${48} products`, async () => {
    await testDb.product.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        name: `P${i}`,
        slug: `p-${i}`,
        status: "active" as const,
      })),
    });

    expect(HOME_PRODUCT_LIMIT).toBe(48);
    expect(await getActiveProducts()).toHaveLength(48);
  });

  it("gives the price range of live variants, ignoring archived ones", async () => {
    const shirt = await product("shirt", {});
    await createVariant(shirt.id, { sku: "A", priceCents: 1500, optionKey: "a" });
    await createVariant(shirt.id, { sku: "B", priceCents: 2500, optionKey: "b" });
    const archived = await createVariant(shirt.id, { sku: "C", priceCents: 100, optionKey: "c" });
    await testDb.productVariant.update({ where: { id: archived.id }, data: { archived: true } });

    const [card] = await getActiveProducts();

    expect(card).toMatchObject({ minPriceCents: 1500, maxPriceCents: 2500, soldOut: false });
  });

  it("is sold out only when every live variant has no stock", async () => {
    const { product: gone } = await createSimpleProduct("gone", 0);
    const { product: left } = await createSimpleProduct("left", 1);

    const cards = await getActiveProducts();

    expect(cards.find((card) => card.id === gone.id)?.soldOut).toBe(true);
    expect(cards.find((card) => card.id === left.id)?.soldOut).toBe(false);
  });

  it("shows the first image by position, or the decorative placeholder", async () => {
    const withImage = await product("with-image", { createdAt: at(2) });
    await product("without-image", { createdAt: at(1) });
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

    const [first, second] = await getActiveProducts();

    expect(first?.image).toEqual({
      src: "http://127.0.0.1:55321/storage/v1/object/public/product-images/products/first.png",
      alt: "Front",
      width: 800,
      height: 1000,
    });
    expect(second?.image).toEqual({ src: "/placeholder.svg", alt: "", width: null, height: null });
  });
});

describe("getProductBySlug", () => {
  it("never sends a stock count above 5, only an availability", async () => {
    const shirt = await product("shirt", {});
    await createVariant(shirt.id, { sku: "A", stockQuantity: 12, optionKey: "a", position: 0 });
    await createVariant(shirt.id, { sku: "B", stockQuantity: 3, optionKey: "b", position: 1 });
    await createVariant(shirt.id, { sku: "C", stockQuantity: 0, optionKey: "c", position: 2 });

    const view = await getProductBySlug("shirt");

    expect(view?.variants.map((variant) => variant.availability)).toEqual([
      { kind: "in_stock" },
      { kind: "low", left: 3 },
      { kind: "sold_out" },
    ]);
    // Ids may contain the digits 12, so look at the numbers and keys the view carries.
    const numbers: number[] = [];
    const keys: string[] = [];
    JSON.stringify(view, (key, value: unknown) => {
      keys.push(key);
      if (typeof value === "number") numbers.push(value);
      return value;
    });
    expect(numbers).not.toContain(12);
    expect(keys.filter((key) => /stock/i.test(key))).toEqual([]);
  });

  it("orders option types and values by position, and each variant's values by option type", async () => {
    const { product: tee, size, color, variants } = await createProductWithOptions("tee");

    const view = await getProductBySlug(tee.slug);

    expect(view?.optionTypes.map((type) => [type.name, type.values.map((v) => v.value)])).toEqual([
      ["Size", ["S", "M"]],
      ["Color", ["Red", "Blue"]],
    ]);
    expect(view?.variants.map((variant) => variant.id)).toEqual(variants.map((v) => v.id));
    // The option key sorts ids, not types; the view must put Size before Color whatever the ids.
    const [s, m] = size.values.toSorted((a, b) => a.position - b.position);
    const [red, blue] = color.values.toSorted((a, b) => a.position - b.position);
    expect(view?.variants.map((variant) => variant.optionValueIds)).toEqual([
      [s?.id, red?.id],
      [s?.id, blue?.id],
      [m?.id, red?.id],
      [m?.id, blue?.id],
    ]);
  });

  it("leaves archived variants out", async () => {
    const shirt = await product("shirt", {});
    const live = await createVariant(shirt.id, { sku: "A", optionKey: "a" });
    const archived = await createVariant(shirt.id, { sku: "B", optionKey: "b", position: 1 });
    await testDb.productVariant.update({ where: { id: archived.id }, data: { archived: true } });

    const view = await getProductBySlug("shirt");

    expect(view?.variants.map((variant) => variant.id)).toEqual([live.id]);
  });

  it.each([
    ["a draft", "draft" as const],
    ["an archived product", "archived" as const],
  ])("is null for %s", async (_, status) => {
    const shirt = await product("shirt", { status });
    await createVariant(shirt.id, { sku: "A" });

    expect(await getProductBySlug("shirt")).toBeNull();
  });

  it("is null for a product with no live variant", async () => {
    await product("empty", {});

    expect(await getProductBySlug("empty")).toBeNull();
  });

  it.each(["unknown", "__none__", "Not A Slug"])(
    "is null for %j, and still tags that slug so creating it clears the cached 404",
    async (slug) => {
      expect(await getProductBySlug(slug)).toBeNull();
      expect(mocks.cacheTag).toHaveBeenCalledWith(`product:${slug}`);
    },
  );
});

describe("getPrerenderedSlugs", () => {
  it("lists only active slugs, newest first", async () => {
    await product("older", { createdAt: at(1) });
    await product("newer", { createdAt: at(2) });
    await product("hidden", { status: "draft", createdAt: at(3) });

    expect(await getPrerenderedSlugs()).toEqual(["newer", "older"]);
  });

  it("is empty on an empty catalog, so the build falls back to a placeholder param", async () => {
    expect(await getPrerenderedSlugs()).toEqual([]);
  });
});

describe("getAdminProducts", () => {
  it("lists every status, newest first, with variant count, total stock and price range", async () => {
    const old = await product("old", { status: "draft", createdAt: at(1) });
    await createVariant(old.id, { sku: "O", priceCents: 900, stockQuantity: 2 });
    const tee = await product("tee", { createdAt: at(2) });
    await createVariant(tee.id, { sku: "T1", priceCents: 1000, stockQuantity: 4, optionKey: "a" });
    await createVariant(tee.id, { sku: "T2", priceCents: 1500, stockQuantity: 6, optionKey: "b" });
    const archived = await createVariant(tee.id, {
      sku: "T3",
      priceCents: 1,
      stockQuantity: 50,
      optionKey: "c",
    });
    await testDb.productVariant.update({ where: { id: archived.id }, data: { archived: true } });

    const rows = await getAdminProducts();

    expect(rows.map((row) => [row.slug, row.status])).toEqual([
      ["tee", "active"],
      ["old", "draft"],
    ]);
    expect(rows[0]).toMatchObject({
      createdAt: at(2),
      variantCount: 2,
      totalStock: 10,
      minPriceCents: 1000,
      maxPriceCents: 1500,
    });
  });

  it(`stops at ${200} products`, async () => {
    await testDb.product.createMany({
      data: Array.from({ length: 201 }, (_, i) => ({ name: `P${i}`, slug: `p-${i}` })),
    });

    expect(ADMIN_PRODUCT_LIMIT).toBe(200);
    expect(await getAdminProducts()).toHaveLength(200);
  });

  it("is empty on an empty catalog", async () => {
    expect(await getAdminProducts()).toEqual([]);
  });
});
