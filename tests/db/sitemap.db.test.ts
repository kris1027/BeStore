import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createVariant } from "./fixtures";

// spec 0018, AC-18 and AC-19: the sitemap reads list only what the storefront shows, tagged so
// the writes that already expire those tags refresh them.

const mocks = vi.hoisted(() => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" } }));
vi.mock("next/cache", () => ({ cacheTag: mocks.cacheTag, cacheLife: mocks.cacheLife }));

const { getSitemapProducts } = await import("@/features/catalog/queries");
const { getSitemapCategories } = await import("@/features/categories/queries");

resetDatabaseBeforeEach();

beforeEach(() => vi.clearAllMocks());

async function product(slug: string, status: "draft" | "active" | "archived", live = true) {
  const row = await testDb.product.create({ data: { name: slug, slug, status } });
  const variant = await createVariant(row.id, { sku: `${slug}-a` });
  if (!live) {
    await testDb.productVariant.update({ where: { id: variant.id }, data: { archived: true } });
  }
  return row;
}

describe("getSitemapProducts", () => {
  it("lists active products with a live variant, never drafts, archived or variant less ones", async () => {
    await product("listed", "active");
    await product("draft", "draft");
    await product("archived", "archived");
    await product("no-live-variant", "active", false);
    await testDb.product.create({ data: { name: "bare", slug: "bare", status: "active" } });

    const entries = await getSitemapProducts();

    expect(entries.map((entry) => entry.slug)).toEqual(["listed"]);
    expect(mocks.cacheTag).toHaveBeenCalledWith("catalog");
  });

  it("gives updated_at as an ISO string and the gallery image URLs in order", async () => {
    const shirt = await product("shirt", "active");
    await testDb.productImage.createMany({
      data: [
        { productId: shirt.id, storagePath: "products/b.jpg", position: 1 },
        { productId: shirt.id, storagePath: "products/a.jpg", position: 0 },
      ],
    });

    const [entry] = await getSitemapProducts();

    expect(entry).toEqual({
      slug: "shirt",
      updatedAt: shirt.updatedAt.toISOString(),
      imageUrls: [
        "http://127.0.0.1:55321/storage/v1/object/public/product-images/products/a.jpg",
        "http://127.0.0.1:55321/storage/v1/object/public/product-images/products/b.jpg",
      ],
    });
  });
});

describe("getSitemapCategories", () => {
  it("lists visible categories only, tagged categories", async () => {
    const shown = await testDb.category.create({
      data: { name: "Shown", slug: "shown", visible: true, position: 0 },
    });
    await testDb.category.create({
      data: { name: "Hidden", slug: "hidden", visible: false, position: 1 },
    });

    expect(await getSitemapCategories()).toEqual([
      { slug: "shown", updatedAt: shown.updatedAt.toISOString() },
    ]);
    expect(mocks.cacheTag).toHaveBeenCalledWith("categories");
  });
});
