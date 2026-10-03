import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import {
  createAdmin,
  createOrder,
  createProductWithOptions,
  createSimpleProduct,
  holding,
  inThirtyDays,
} from "./fixtures";

// Arranging, deleting and the Categories section against a real Postgres (spec 0009, AC-4,
// AC-14, AC-18, AC-20, AC-21, AC-23, AC-24).

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  updateTag: vi.fn(),
  info: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ storage: { from: () => ({ remove: mocks.remove }) } }),
}));
vi.mock("@/lib/logger", async (importOriginal) =>
  (await import("./logger-mock")).mockLoggerModule(importOriginal, {
    info: mocks.info,
    warn: vi.fn(),
    error: vi.fn(),
  }),
);

const { reorderProducts } = await import("@/features/catalog/actions/reorder-products");
const { deleteProduct } = await import("@/features/catalog/actions/delete-product");
const { updateProductCategories } =
  await import("@/features/catalog/actions/update-product-categories");
const { getProductForEdit } = await import("@/features/catalog/admin-queries");

resetDatabaseBeforeEach();

let adminId = "";

beforeEach(async () => {
  vi.clearAllMocks();
  adminId = (await createAdmin()).id;
  mocks.requireAdmin.mockResolvedValue({ id: adminId, email: "admin@example.com", name: "Admin" });
  mocks.remove.mockResolvedValue({ data: [], error: null });
});

async function activeIds() {
  return (
    await testDb.product.findMany({
      where: { status: "active" },
      orderBy: [{ position: "asc" }],
      select: { id: true },
    })
  ).map((row) => row.id);
}

describe("reorderProducts", () => {
  it("rewrites every active position without touching updated_at, and expires the grid", async () => {
    const a = (await createSimpleProduct("a")).product;
    const b = (await createSimpleProduct("b")).product;
    const c = (await createSimpleProduct("c")).product;
    await testDb.product.create({ data: { name: "Draft", slug: "draft" } });
    const before = await testDb.product.findUniqueOrThrow({ where: { id: a.id } });

    const result = await reorderProducts({ orderedIds: [c.id, a.id, b.id] });

    expect(result).toEqual({ ok: true, data: null });
    expect(await activeIds()).toEqual([c.id, a.id, b.id]);
    expect(
      (
        await testDb.product.findMany({ where: { status: "active" }, orderBy: { position: "asc" } })
      ).map((p) => p.position),
    ).toEqual([0, 1, 2]);
    expect((await testDb.product.findUniqueOrThrow({ where: { id: a.id } })).updatedAt).toEqual(
      before.updatedAt,
    );
    expect(mocks.updateTag.mock.calls.map(([tag]) => tag)).toEqual(["catalog"]);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "catalog.products.reordered", adminId, count: 3 },
      "catalog.products.reordered",
    );
  });

  it("refuses a list that is not exactly the active products, moving nothing", async () => {
    const a = (await createSimpleProduct("a")).product;
    const b = (await createSimpleProduct("b")).product;
    const draft = await testDb.product.create({ data: { name: "Draft", slug: "draft" } });
    const before = await activeIds();

    for (const orderedIds of [[b.id], [b.id, a.id, draft.id], [b.id, b.id]]) {
      expect(await reorderProducts({ orderedIds })).toEqual({
        ok: false,
        error: { code: "stale" },
      });
    }
    expect(await activeIds()).toEqual(before);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});

describe("deleteProduct", () => {
  it("deletes a draft with everything that hangs off it, then its files", async () => {
    const { product, variants, color } = await createProductWithOptions("t");
    await testDb.product.update({ where: { id: product.id }, data: { status: "draft" } });
    await testDb.productImage.create({
      data: {
        productId: product.id,
        storagePath: "products/x.png",
        position: 0,
        optionValueId: color.values[0]!.id,
      },
    });
    const category = await testDb.category.create({
      data: {
        name: "C",
        slug: "c",
        position: 0,
        products: { create: { productId: product.id, position: 0 } },
      },
    });
    await testDb.stockMovement.create({
      data: {
        variantId: variants[0]!.id,
        kind: "initial",
        delta: 3,
        stockAfter: 3,
        actorType: "system",
      },
    });
    const cart = await testDb.cart.create({
      data: {
        expiresAt: inThirtyDays(),
        items: { create: { variantId: variants[0]!.id, quantity: 1 } },
      },
    });
    expect((await getProductForEdit(product.id))?.deletable).toBe(true);

    const result = await deleteProduct({ productId: product.id });

    expect(result).toEqual({ ok: true, data: null });
    expect(
      await Promise.all([
        testDb.product.count(),
        testDb.productVariant.count(),
        testDb.productOptionType.count(),
        testDb.productOptionValue.count(),
        testDb.productImage.count(),
        testDb.productCategory.count(),
        testDb.stockMovement.count(),
        testDb.cartItem.count({ where: { cartId: cart.id } }),
      ]),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await testDb.category.count({ where: { id: category.id } })).toBe(1);
    expect(mocks.remove).toHaveBeenCalledWith(["products/x.png"]);
    expect(mocks.updateTag.mock.calls.map(([tag]) => tag)).toEqual(["catalog", "product:tee-t"]);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "catalog.product.deleted", adminId, productId: product.id },
      "catalog.product.deleted",
    );
  });

  it("refuses a live product: hide it first", async () => {
    const { product } = await createSimpleProduct("1");

    expect((await getProductForEdit(product.id))?.deletable).toBe(false);
    expect(await deleteProduct({ productId: product.id })).toEqual({
      ok: false,
      error: { code: "is_active" },
    });
  });

  it.each(["pending_payment", "expired"] as const)(
    "refuses a product on any order line, %s included, by product or by variant",
    async (status) => {
      const { product, variant } = await createSimpleProduct("1");
      await testDb.product.update({ where: { id: product.id }, data: { status: "archived" } });
      const order = await createOrder({ status });
      await testDb.orderLine.create({
        data: {
          orderId: order.id,
          variantId: variant.id,
          productName: "Tee",
          sku: variant.sku,
          unitPriceCents: 5000,
          quantity: 1,
          lineTotalCents: 5000,
        },
      });

      expect((await getProductForEdit(product.id))?.deletable).toBe(false);
      expect(await deleteProduct({ productId: product.id })).toEqual({
        ok: false,
        error: { code: "on_order" },
      });
      expect(await testDb.product.count()).toBe(1);
    },
  );

  it("waits for a checkout holding the variants, then sees its order line", async () => {
    const { product, variant } = await createSimpleProduct("1");
    await testDb.product.update({ where: { id: product.id }, data: { status: "draft" } });
    const order = await createOrder();

    // A checkout that took its FOR KEY SHARE and has not committed its order line yet.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const checkout = testDb.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${variant.id}::uuid FOR KEY SHARE`;
        locked();
        await held;
        await tx.orderLine.create({
          data: {
            orderId: order.id,
            variantId: variant.id,
            productId: product.id,
            productName: "Tee",
            sku: variant.sku,
            unitPriceCents: 5000,
            quantity: 1,
            lineTotalCents: 5000,
          },
        });
      },
      { timeout: 10_000 },
    );
    await isLocked;

    const deleting = deleteProduct({ productId: product.id });
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await checkout;

    expect(await deleting).toEqual({ ok: false, error: { code: "on_order" } });
    expect(await testDb.product.count()).toBe(1);
  });
});

describe("updateProductCategories", () => {
  async function category(slug: string, position: number) {
    return testDb.category.create({ data: { name: slug, slug, position } });
  }

  it("adds the product at the end of each new category and removes the old link", async () => {
    const { product } = await createSimpleProduct("1");
    const other = await createSimpleProduct("2");
    const keep = await category("keep", 0);
    const join = await category("join", 1);
    const leave = await category("leave", 2);
    await testDb.productCategory.createMany({
      data: [
        { productId: product.id, categoryId: keep.id, position: 0 },
        { productId: product.id, categoryId: leave.id, position: 0 },
        { productId: other.product.id, categoryId: join.id, position: 4 },
      ],
    });

    const result = await updateProductCategories({
      productId: product.id,
      loadedCategoryIds: [leave.id, keep.id],
      categoryIds: [keep.id, join.id],
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(
      await testDb.productCategory.findMany({
        where: { productId: product.id },
        orderBy: { position: "asc" },
        select: { categoryId: true, position: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { categoryId: keep.id, position: 0 },
        { categoryId: join.id, position: 5 },
      ]),
    );
    expect(await testDb.productCategory.count({ where: { productId: product.id } })).toBe(2);
    // AC-23: no storefront read uses categories yet.
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("refuses a save over another change to the product's categories", async () => {
    const { product } = await createSimpleProduct("1");
    const a = await category("a", 0);
    await testDb.productCategory.create({
      data: { productId: product.id, categoryId: a.id, position: 0 },
    });

    expect(
      await updateProductCategories({
        productId: product.id,
        loadedCategoryIds: [],
        categoryIds: [],
      }),
    ).toEqual({ ok: false, error: { code: "stale" } });
  });

  it("refuses an unknown category", async () => {
    const { product } = await createSimpleProduct("1");

    expect(
      await updateProductCategories({
        productId: product.id,
        loadedCategoryIds: [],
        categoryIds: ["01890000-0000-7000-8000-000000000000"],
      }),
    ).toEqual({ ok: false, error: { code: "unknown_category" } });
  });

  it("refuses a category deleted while the save waited for it, as a value", async () => {
    const { product } = await createSimpleProduct("1");
    const gone = await category("gone", 0);

    const deleting = holding(
      (tx) => tx.category.delete({ where: { id: gone.id } }),
      async () => null,
    );
    await deleting.locked;

    const saving = updateProductCategories({
      productId: product.id,
      loadedCategoryIds: [],
      categoryIds: [gone.id],
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    deleting.release();
    await deleting.done;

    expect(await saving).toEqual({ ok: false, error: { code: "unknown_category" } });
    expect(await testDb.productCategory.count()).toBe(0);
  });

  it("does not deadlock with products being added to the category from its page", async () => {
    const { product } = await createSimpleProduct("1");
    const join = await category("join", 0);

    // setCategoryProducts: the category row first, then a link whose foreign key needs a key
    // share on the product.
    const adding = holding(
      (tx) => tx.$queryRaw`SELECT id FROM categories WHERE id = ${join.id}::uuid FOR UPDATE`,
      (tx) =>
        tx.productCategory.create({
          data: { productId: product.id, categoryId: join.id, position: 0 },
        }),
    );
    await adding.locked;

    const saving = updateProductCategories({
      productId: product.id,
      loadedCategoryIds: [],
      categoryIds: [join.id],
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    adding.release();

    await expect(adding.done).resolves.toBeDefined();
    // The link the category page made first is the one kept.
    expect(await saving).toEqual({ ok: true, data: null });
    expect(await testDb.productCategory.count()).toBe(1);
  });
});
