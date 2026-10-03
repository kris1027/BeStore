import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createSimpleProduct } from "./fixtures";

// The category actions and admin reads against a real Postgres (spec 0009, AC-17 to AC-21,
// AC-24).

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), info: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
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
