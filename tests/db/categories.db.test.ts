import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createSimpleProduct } from "./fixtures";

// The category actions and admin reads against a real Postgres (spec 0009, AC-17 to AC-21,
// AC-24), their cache expiry and the arrange action (spec 0013, AC-22, AC-23).

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), info: vi.fn(), updateTag: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/logger", async (importOriginal) =>
  (await import("./logger-mock")).mockLoggerModule(importOriginal, {
    info: mocks.info,
    warn: vi.fn(),
    error: vi.fn(),
  }),
);

const { createCategory } = await import("@/features/categories/actions/create-category");
const { updateCategory } = await import("@/features/categories/actions/update-category");
const { deleteCategory } = await import("@/features/categories/actions/delete-category");
const { reorderCategories } = await import("@/features/categories/actions/reorder-categories");
const { setCategoryProducts } = await import("@/features/categories/actions/set-category-products");
const { reorderCategoryProducts } =
  await import("@/features/categories/actions/reorder-category-products");
const { getAdminCategories, getCategoryForEdit } =
  await import("@/features/categories/admin-queries");

resetDatabaseBeforeEach();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin-1", email: "a@example.com", name: "Ada" });
});

const fields = (slug: string) => ({ name: `Cat ${slug}`, slug, description: "", visible: true });

async function create(slug: string) {
  const result = await createCategory(fields(slug));
  if (!result.ok) throw new Error(`could not create ${slug}`);
  return result.data.categoryId;
}

describe("createCategory", () => {
  it("adds the category last, with an empty description stored as none, and logs", async () => {
    const first = await create("linen");
    const second = await create("wool");

    expect(
      await testDb.category.findMany({
        orderBy: { position: "asc" },
        select: { id: true, position: true, description: true, visible: true },
      }),
    ).toEqual([
      { id: first, position: 0, description: null, visible: true },
      { id: second, position: 1, description: null, visible: true },
    ]);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "catalog.category.created", adminId: "admin-1", categoryId: first },
      "catalog.category.created",
    );
  });

  it("answers field errors and a taken slug", async () => {
    await create("linen");

    expect(await createCategory({ ...fields("Bad Slug"), name: "" })).toEqual({
      ok: false,
      error: {
        code: "validation",
        fields: {
          name: "Enter a name.",
          slug: "Use lowercase letters and digits, joined by single hyphens.",
        },
      },
    });
    expect(await createCategory(fields("linen"))).toEqual({
      ok: false,
      error: { code: "slug_taken" },
    });
  });
});

describe("updateCategory", () => {
  it("saves while nobody changed it, and refuses a save over another change", async () => {
    const id = await create("linen");
    const loaded = (await testDb.category.findUniqueOrThrow({ where: { id } })).updatedAt;

    expect(
      await updateCategory({
        ...fields("linen-2"),
        description: "Summer weight.",
        visible: false,
        categoryId: id,
        loadedUpdatedAt: loaded.toISOString(),
      }),
    ).toEqual({ ok: true, data: null });
    expect(await testDb.category.findUniqueOrThrow({ where: { id } })).toMatchObject({
      slug: "linen-2",
      description: "Summer weight.",
      visible: false,
    });

    expect(
      await updateCategory({
        ...fields("linen-3"),
        categoryId: id,
        loadedUpdatedAt: loaded.toISOString(),
      }),
    ).toEqual({ ok: false, error: { code: "stale" } });
  });

  it("is not refused by a reorder", async () => {
    const a = await create("a");
    const b = await create("b");
    const loaded = (await testDb.category.findUniqueOrThrow({ where: { id: a } })).updatedAt;
    await reorderCategories({ orderedIds: [b, a] });

    expect(
      (
        await updateCategory({
          ...fields("a2"),
          categoryId: a,
          loadedUpdatedAt: loaded.toISOString(),
        })
      ).ok,
    ).toBe(true);
  });
});

describe("reorderCategories", () => {
  it("rewrites positions, and refuses a list that is not every category", async () => {
    const a = await create("a");
    const b = await create("b");
    const c = await create("c");

    expect(await reorderCategories({ orderedIds: [c, a, b] })).toEqual({ ok: true, data: null });
    expect((await getAdminCategories()).map((row) => row.id)).toEqual([c, a, b]);

    expect(await reorderCategories({ orderedIds: [a, b] })).toEqual({
      ok: false,
      error: { code: "stale" },
    });
    expect((await getAdminCategories()).map((row) => row.id)).toEqual([c, a, b]);
  });
});

describe("setCategoryProducts and deleteCategory", () => {
  it("adds products at the end, ignores repeats and missing removals, and counts every status", async () => {
    const id = await create("linen");
    const one = (await createSimpleProduct("1")).product;
    const two = (await createSimpleProduct("2")).product;
    await testDb.product.update({ where: { id: two.id }, data: { status: "archived" } });

    expect(await setCategoryProducts({ categoryId: id, add: [one.id] })).toEqual({
      ok: true,
      data: null,
    });
    expect(await setCategoryProducts({ categoryId: id, add: [two.id, one.id] })).toEqual({
      ok: true,
      data: null,
    });
    expect(
      await setCategoryProducts({
        categoryId: id,
        remove: ["01890000-0000-7000-8000-000000000000"],
      }),
    ).toEqual({ ok: true, data: null });

    const category = await getCategoryForEdit(id);
    expect(category?.products.map((product) => product.id)).toEqual([one.id, two.id]);
    expect((await getAdminCategories())[0]?.productCount).toBe(2);

    await setCategoryProducts({ categoryId: id, remove: [one.id] });
    expect((await getCategoryForEdit(id))?.products.map((product) => product.id)).toEqual([two.id]);
  });

  it("refuses an unknown product or category", async () => {
    const id = await create("linen");

    expect(
      await setCategoryProducts({ categoryId: id, add: ["01890000-0000-7000-8000-000000000000"] }),
    ).toEqual({ ok: false, error: { code: "unknown_product" } });
    expect(
      await setCategoryProducts({ categoryId: "01890000-0000-7000-8000-000000000000", add: [] }),
    ).toEqual({ ok: false, error: { code: "not_found" } });
  });

  it("deletes a category and its links, leaving the products", async () => {
    const id = await create("linen");
    const { product } = await createSimpleProduct("1");
    await setCategoryProducts({ categoryId: id, add: [product.id] });

    expect(await deleteCategory({ categoryId: id })).toEqual({ ok: true, data: null });
    expect(await testDb.category.count()).toBe(0);
    expect(await testDb.productCategory.count()).toBe(0);
    expect(await testDb.product.count()).toBe(1);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "catalog.category.deleted", adminId: "admin-1", categoryId: id, products: 1 },
      "catalog.category.deleted",
    );
    expect(await deleteCategory({ categoryId: id })).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("loads null for an unknown or malformed id", async () => {
    expect(await getCategoryForEdit("01890000-0000-7000-8000-000000000000")).toBeNull();
    expect(await getCategoryForEdit("nope")).toBeNull();
  });
});

const tags = () => mocks.updateTag.mock.calls.map(([tag]) => tag);

describe("category cache expiry (spec 0013, AC-22)", () => {
  it("expires the categories tag after every write, and catalog after a delete", async () => {
    const id = await create("linen");
    expect(tags()).toEqual(["categories"]);

    mocks.updateTag.mockClear();
    const { updatedAt } = await testDb.category.findUniqueOrThrow({ where: { id } });
    await updateCategory({
      ...fields("linen"),
      visible: false,
      categoryId: id,
      loadedUpdatedAt: updatedAt.toISOString(),
    });
    expect(tags()).toEqual(["categories"]);

    mocks.updateTag.mockClear();
    await reorderCategories({ orderedIds: [id] });
    expect(tags()).toEqual(["categories"]);

    mocks.updateTag.mockClear();
    const { product } = await createSimpleProduct("1");
    await setCategoryProducts({ categoryId: id, add: [product.id] });
    expect(tags()).toEqual(["categories"]);

    mocks.updateTag.mockClear();
    await deleteCategory({ categoryId: id });
    expect(tags()).toEqual(["categories", "catalog"]);
  });

  it("expires nothing when a write is refused", async () => {
    await createCategory({ ...fields("bad slug"), slug: "Bad Slug" });
    await reorderCategories({ orderedIds: ["01890000-0000-7000-8000-000000000000"] });
    await deleteCategory({ categoryId: "01890000-0000-7000-8000-000000000000" });

    expect(mocks.updateTag).not.toHaveBeenCalled();
  });
});

describe("reorderCategoryProducts (spec 0013, AC-23)", () => {
  async function linked(count: number) {
    const id = await create("linen");
    const products = [];
    for (let i = 0; i < count; i += 1)
      products.push((await createSimpleProduct(String(i))).product);
    await setCategoryProducts({ categoryId: id, add: products.map((product) => product.id) });
    return { id, ids: products.map((product) => product.id) };
  }

  it("rewrites the category's positions to 0..n-1 in the given order and logs counts only", async () => {
    const { id, ids } = await linked(3);
    const [a, b, c] = ids;
    mocks.updateTag.mockClear();

    expect(await reorderCategoryProducts({ categoryId: id, productIds: [c, a, b] })).toEqual({
      ok: true,
      data: null,
    });

    const rows = await testDb.productCategory.findMany({
      where: { categoryId: id },
      orderBy: { position: "asc" },
      select: { productId: true, position: true },
    });
    expect(rows).toEqual([
      { productId: c, position: 0 },
      { productId: a, position: 1 },
      { productId: b, position: 2 },
    ]);
    expect((await getCategoryForEdit(id))?.products.map((product) => product.id)).toEqual([
      c,
      a,
      b,
    ]);
    expect(tags()).toEqual(["categories"]);
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: "catalog.category.products_reordered",
        adminId: "admin-1",
        categoryId: id,
        count: 3,
      },
      "catalog.category.products_reordered",
    );
  });

  it("leaves the products' own updated_at alone", async () => {
    const { id, ids } = await linked(2);
    const before = await testDb.product.findMany({ select: { id: true, updatedAt: true } });

    await reorderCategoryProducts({ categoryId: id, productIds: ids.toReversed() });

    expect(await testDb.product.findMany({ select: { id: true, updatedAt: true } })).toEqual(
      before,
    );
  });

  it("refuses with stale unless the list is exactly the category's current set, saving nothing", async () => {
    const { id, ids } = await linked(2);
    const [a, b] = ids;
    const { product: other } = await createSimpleProduct("other");
    mocks.updateTag.mockClear();

    for (const productIds of [[a], [a, b, other.id], [a, a], [b, other.id]]) {
      expect(await reorderCategoryProducts({ categoryId: id, productIds })).toEqual({
        ok: false,
        error: { code: "stale" },
      });
    }
    expect(
      await reorderCategoryProducts({
        categoryId: "01890000-0000-7000-8000-000000000000",
        productIds: [a, b],
      }),
    ).toEqual({ ok: false, error: { code: "stale" } });
    expect((await getCategoryForEdit(id))?.products.map((product) => product.id)).toEqual([a, b]);
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("refuses with stale when a product joins meanwhile", async () => {
    const { id, ids } = await linked(2);
    const { product: late } = await createSimpleProduct("late");
    await setCategoryProducts({ categoryId: id, add: [late.id] });

    expect(await reorderCategoryProducts({ categoryId: id, productIds: ids.toReversed() })).toEqual(
      {
        ok: false,
        error: { code: "stale" },
      },
    );
  });

  it("answers invalid for malformed input", async () => {
    expect(await reorderCategoryProducts({ categoryId: "nope", productIds: [] })).toEqual({
      ok: false,
      error: { code: "invalid" },
    });
    expect(
      await reorderCategoryProducts({ categoryId: "01890000-0000-7000-8000-000000000000" }),
    ).toEqual({
      ok: false,
      error: { code: "invalid" },
    });
  });

  it("is refused for anyone requireAdmin turns away", async () => {
    const { id, ids } = await linked(1);
    mocks.requireAdmin.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));

    await expect(reorderCategoryProducts({ categoryId: id, productIds: ids })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
  });
});
