import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { seedDemoCatalog } from "../../prisma/demo-catalog";
import { resetDatabaseBeforeEach, testDb } from "./client";

resetDatabaseBeforeEach();

async function catalogCounts() {
  return {
    categories: await testDb.category.count(),
    products: await testDb.product.count(),
    optionTypes: await testDb.productOptionType.count(),
    optionValues: await testDb.productOptionValue.count(),
    variants: await testDb.productVariant.count(),
    variantOptionValues: await testDb.variantOptionValue.count(),
    productCategories: await testDb.productCategory.count(),
  };
}

describe("demo seed (AC-13)", () => {
  it("fills a simple product, one with Size, and one with Size and Color", async () => {
    await seedDemoCatalog(testDb);

    const products = await testDb.product.findMany({
      orderBy: { position: "asc" },
      include: { optionTypes: { orderBy: { position: "asc" } }, variants: true, categories: true },
    });
    expect(
      products.map((p) => [p.slug, p.optionTypes.map((t) => t.name), p.variants.length]),
    ).toEqual([
      ["canvas-tote-bag", [], 1],
      ["classic-hoodie", ["Size"], 3],
      ["organic-tee", ["Size", "Color"], 6],
    ]);
    expect(products.every((p) => p.status === "active" && p.categories.length > 0)).toBe(true);
    expect(products[0]?.variants[0]?.optionKey).toBe("");
    expect(await testDb.category.count()).toBe(2);
  });

  it("keeps each variant's option_key in step with its option values", async () => {
    await seedDemoCatalog(testDb);

    const variants = await testDb.productVariant.findMany({ include: { optionValues: true } });
    for (const variant of variants) {
      const key = variant.optionValues
        .map((v) => v.optionValueId)
        .toSorted()
        .join(",");
      expect(variant.optionKey).toBe(key);
    }
  });

  it("is safe to run twice: no errors, no duplicates", async () => {
    await seedDemoCatalog(testDb);
    const first = await catalogCounts();

    await seedDemoCatalog(testDb);

    expect(await catalogCounts()).toEqual(first);
  });

  it("refuses a non local DIRECT_URL without --yes, before connecting", () => {
    const result = spawnSync("pnpm", ["exec", "tsx", "prisma/seed.ts"], {
      env: { ...process.env, DIRECT_URL: "postgresql://u:p@db.example.com:5432/postgres" },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to seed db.example.com");
  });
});
