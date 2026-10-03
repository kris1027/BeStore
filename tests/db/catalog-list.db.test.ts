import { describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createVariant } from "./fixtures";

// The admin product list and the category picker search against a real Postgres (spec 0009,
// AC-1, AC-18).

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" } }));

const {
  ADMIN_PRODUCTS_PAGE_SIZE,
  getAdminProducts,
  parseAdminProductsParams,
  PICKER_LIMIT,
  searchProductsForPicker,
} = await import("@/features/catalog/admin-queries");

resetDatabaseBeforeEach();

async function slugs(params: Record<string, unknown>) {
  return (await getAdminProducts(parseAdminProductsParams(params))).rows
    .map((row) => row.slug)
    .sort();
}

describe("parseAdminProductsParams", () => {
  it("falls back to defaults for unknown or malformed values", () => {
    expect(
      parseAdminProductsParams({
        status: "bogus",
        featured: "yes",
        q: "  x ".repeat(1),
        category: "not-a-uuid",
        before: "nope",
      }),
    ).toEqual({ tab: "all", q: "x", categoryId: null, before: null });
  });

  it("reads featured=1 as the Featured tab, and trims and caps the search", () => {
    expect(parseAdminProductsParams({ featured: "1", q: ` ${"a".repeat(150)} ` })).toEqual({
      tab: "featured",
      q: "a".repeat(100),
      categoryId: null,
      before: null,
    });
  });
});

describe("getAdminProducts", () => {
  it("filters by status tab; All and Featured leave out archived products", async () => {
    await testDb.product.createMany({
      data: [
        { name: "A", slug: "a", status: "active", featured: true },
        { name: "D", slug: "d", status: "draft" },
        { name: "X", slug: "x", status: "archived", featured: true },
      ],
    });

    expect(await slugs({})).toEqual(["a", "d"]);
    expect(await slugs({ status: "active" })).toEqual(["a"]);
    expect(await slugs({ status: "draft" })).toEqual(["d"]);
    expect(await slugs({ status: "archived" })).toEqual(["x"]);
    expect(await slugs({ featured: "1" })).toEqual(["a"]);
  });

  it("searches names and any variant SKU, case insensitive, with wildcards taken literally", async () => {
    const wool = await testDb.product.create({ data: { name: "100% Wool scarf", slug: "wool" } });
    await testDb.product.create({ data: { name: "1000 threads", slug: "threads" } });
    const mug = await testDb.product.create({ data: { name: "Mug", slug: "mug" } });
    await createVariant(mug.id, { sku: "CERAMIC_MUG-01" });
    await createVariant(wool.id, { sku: "SCARF-1" });

    expect(await slugs({ q: "wool" })).toEqual(["wool"]);
    expect(await slugs({ q: "0%" })).toEqual(["wool"]);
    expect(await slugs({ q: "ic_m" })).toEqual(["mug"]);
    expect(await slugs({ q: "ic%g" })).toEqual([]);
    expect(await slugs({ q: "scarf-1" })).toEqual(["wool"]);
  });

  it("filters by category", async () => {
    const [a] = await Promise.all([
      testDb.product.create({ data: { name: "A", slug: "a" } }),
      testDb.product.create({ data: { name: "B", slug: "b" } }),
    ]);
    const category = await testDb.category.create({
      data: {
        name: "Linen",
        slug: "linen",
        position: 0,
        products: { create: { productId: a.id, position: 0 } },
      },
    });

    expect(await slugs({ category: category.id })).toEqual(["a"]);
  });

  it("pages 50 at a time, newest first, with a cursor for the next page", async () => {
    for (let i = 0; i < ADMIN_PRODUCTS_PAGE_SIZE + 5; i += 1) {
      await testDb.product.create({ data: { name: `P${i}`, slug: `p-${i}` } });
    }

    const first = await getAdminProducts(parseAdminProductsParams({}));
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0]?.slug).toBe("p-54");
    expect(first.nextBefore).toBe(first.rows.at(-1)?.id);

    const second = await getAdminProducts(parseAdminProductsParams({ before: first.nextBefore }));
    expect(second.rows.map((row) => row.slug)).toEqual(["p-4", "p-3", "p-2", "p-1", "p-0"]);
    expect(second.nextBefore).toBeNull();
  });
});

describe("searchProductsForPicker", () => {
  it("finds any status by name or SKU, up to 20, and nothing for an empty search", async () => {
    await testDb.product.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        name: `Tee ${i}`,
        slug: `tee-${i}`,
        status: i % 3 === 0 ? ("archived" as const) : ("draft" as const),
      })),
    });

    expect(await searchProductsForPicker("tee")).toHaveLength(PICKER_LIMIT);
    expect((await searchProductsForPicker("Tee 3")).map((p) => p.status)).toEqual(["archived"]);
    expect(await searchProductsForPicker("   ")).toEqual([]);
  });
});
