import { beforeEach, describe, expect, it, vi } from "vitest";

import { testDb, resetDatabaseBeforeEach } from "./client";
import { createAdmin, createProduct, createVariant } from "./fixtures";

// The Details section and status changes against a real Postgres (spec 0009, AC-2, AC-3, AC-5,
// AC-21, AC-23, AC-24).

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  updateTag: vi.fn(),
  info: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: vi.fn() } }));

const { updateProductDetails } = await import("@/features/catalog/actions/update-details");
const { changeProductStatus } = await import("@/features/catalog/actions/change-status");
const { getAdminProducts, getProductForEdit, parseAdminProductsParams } =
  await import("@/features/catalog/admin-queries");

resetDatabaseBeforeEach();

// A real admin row: stock movements reference it.
let adminId = "";

beforeEach(async () => {
  vi.clearAllMocks();
  adminId = (await createAdmin()).id;
  mocks.requireAdmin.mockResolvedValue({ id: adminId, email: "admin@example.com", name: "Admin" });
});

async function details(productId: string, overrides: Record<string, unknown> = {}) {
  const product = await testDb.product.findUniqueOrThrow({ where: { id: productId } });
  return {
    productId,
    loadedUpdatedAt: product.updatedAt.toISOString(),
    name: product.name,
    slug: product.slug,
    description: product.description,
    featured: product.featured,
    weightGrams: product.weightGrams === null ? "" : String(product.weightGrams),
    ...overrides,
  };
}

describe("updateProductDetails", () => {
  it("saves every field, expires the old and new slug and logs the section", async () => {
    const product = await createProduct("1");
    const input = await details(product.id, {
      name: "  Linen tee ",
      slug: "linen-tee",
      description: "Soft.",
      featured: true,
      weightGrams: "250",
    });

    const result = await updateProductDetails(input);

    expect(result).toEqual({ ok: true, data: { slug: "linen-tee" } });
    const saved = await testDb.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(saved).toMatchObject({
      name: "Linen tee",
      slug: "linen-tee",
      description: "Soft.",
      featured: true,
      weightGrams: 250,
    });
    expect(mocks.updateTag.mock.calls.map(([tag]) => tag)).toEqual([
      "catalog",
      "product:tee-1",
      "product:linen-tee",
    ]);
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: "catalog.product.updated",
        adminId,
        productId: product.id,
        section: "details",
      },
      "catalog.product.updated",
    );
  });

  it("clears the weight when the field is empty", async () => {
    const product = await testDb.product.create({
      data: { name: "Mug", slug: "mug", weightGrams: 400 },
    });

    await updateProductDetails(await details(product.id, { weightGrams: "" }));

    expect(
      (await testDb.product.findUniqueOrThrow({ where: { id: product.id } })).weightGrams,
    ).toBeNull();
  });

  it("refuses a save over a change made since the page loaded, writing nothing", async () => {
    const product = await createProduct("1");
    const stale = await details(product.id, { name: "Mine" });
    await updateProductDetails(await details(product.id, { name: "Theirs" }));
    mocks.updateTag.mockClear();

    const result = await updateProductDetails(stale);

    expect(result).toEqual({ ok: false, error: { code: "stale" } });
    expect((await testDb.product.findUniqueOrThrow({ where: { id: product.id } })).name).toBe(
      "Theirs",
    );
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("is not refused by a sale on one of its variants", async () => {
    const product = await createProduct("1");
    const variant = await createVariant(product.id);
    const input = await details(product.id, { name: "Renamed" });
    // What takeStock does on a paid order: it touches the variant row only.
    await testDb.$executeRaw`
      UPDATE product_variants SET stock_quantity = stock_quantity - 1, updated_at = now()
      WHERE id = ${variant.id}::uuid`;

    expect((await updateProductDetails(input)).ok).toBe(true);
  });

  it("refuses a URL name another product uses", async () => {
    await createProduct("1");
    const other = await createProduct("2");

    const result = await updateProductDetails(await details(other.id, { slug: "tee-1" }));

    expect(result).toEqual({ ok: false, error: { code: "slug_taken" } });
  });

  it("answers validation errors by field and not found for an unknown product", async () => {
    const product = await createProduct("1");

    const invalid = await updateProductDetails(
      await details(product.id, { name: "", slug: "Not A Slug", weightGrams: "0" }),
    );
    expect(invalid.ok).toBe(false);
    if (invalid.ok || invalid.error.code !== "validation") throw new Error("expected validation");
    expect(Object.keys(invalid.error.fields).sort()).toEqual(["name", "slug", "weightGrams"]);

    const gone = await updateProductDetails({
      ...(await details(product.id)),
      productId: "01890000-0000-7000-8000-000000000000",
    });
    expect(gone).toEqual({ ok: false, error: { code: "not_found" } });
  });
});

describe("changeProductStatus", () => {
  async function statusOf(id: string) {
    return (await testDb.product.findUniqueOrThrow({ where: { id } })).status;
  }

  it("publishes a draft first on the home grid", async () => {
    const live = await createProduct("live");
    await testDb.product.update({ where: { id: live.id }, data: { position: 3 } });
    const draft = await testDb.product.create({ data: { name: "New", slug: "new" } });
    await createVariant(draft.id, { sku: "NEW" });

    const result = await changeProductStatus({ productId: draft.id, to: "active" });

    expect(result).toEqual({ ok: true, data: { status: "active" } });
    expect(await testDb.product.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: "active",
      position: 2,
    });
    expect(mocks.updateTag.mock.calls.map(([tag]) => tag)).toEqual(["catalog", "product:new"]);
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: "catalog.product.status_changed",
        adminId,
        productId: draft.id,
        from: "draft",
        to: "active",
      },
      "catalog.product.status_changed",
    );
  });

  it("publishes at position 0 when nothing else is active", async () => {
    const draft = await testDb.product.create({ data: { name: "New", slug: "new", position: 7 } });
    await createVariant(draft.id);

    await changeProductStatus({ productId: draft.id, to: "active" });

    expect((await testDb.product.findUniqueOrThrow({ where: { id: draft.id } })).position).toBe(0);
  });

  it("refuses to publish a product with no variant left to sell", async () => {
    const draft = await testDb.product.create({ data: { name: "New", slug: "new" } });
    const variant = await createVariant(draft.id);
    await testDb.productVariant.update({ where: { id: variant.id }, data: { archived: true } });

    const result = await changeProductStatus({ productId: draft.id, to: "active" });

    expect(result).toEqual({ ok: false, error: { code: "no_variants" } });
    expect(await statusOf(draft.id)).toBe("draft");
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("hides, archives and restores to draft, never straight to active", async () => {
    const product = await createProduct("1");

    expect((await changeProductStatus({ productId: product.id, to: "draft" })).ok).toBe(true);
    expect(await statusOf(product.id)).toBe("draft");
    expect((await changeProductStatus({ productId: product.id, to: "archived" })).ok).toBe(true);
    expect(await changeProductStatus({ productId: product.id, to: "active" })).toEqual({
      ok: false,
      error: { code: "invalid_transition" },
    });
    expect((await changeProductStatus({ productId: product.id, to: "draft" })).ok).toBe(true);
    expect(await statusOf(product.id)).toBe("draft");
  });

  it("refuses an unknown product or a malformed request", async () => {
    expect(
      await changeProductStatus({
        productId: "01890000-0000-7000-8000-000000000000",
        to: "draft",
      }),
    ).toEqual({ ok: false, error: { code: "not_found" } });
    expect(await changeProductStatus({ productId: "x", to: "gone" })).toEqual({
      ok: false,
      error: { code: "invalid_transition" },
    });
  });
});

describe("admin reads", () => {
  it("loads a product for edit, and null for an unknown or malformed id", async () => {
    const product = await createProduct("1");
    await createVariant(product.id);

    expect(await getProductForEdit(product.id)).toMatchObject({
      id: product.id,
      slug: "tee-1",
      status: "active",
      optionTypes: [],
      variants: [{ label: "Default", optionValueIds: [], archived: false }],
    });
    expect(await getProductForEdit("01890000-0000-7000-8000-000000000000")).toBeNull();
    expect(await getProductForEdit("not-a-uuid")).toBeNull();
  });

  it("filters the list by status tab; All leaves out archived products", async () => {
    await testDb.product.createMany({
      data: [
        { name: "A", slug: "a", status: "active", featured: true },
        { name: "D", slug: "d", status: "draft" },
        { name: "X", slug: "x", status: "archived", featured: true },
      ],
    });
    const slugs = async (status: unknown) =>
      (await getAdminProducts(parseAdminProductsParams({ status }))).map((row) => row.slug).sort();

    expect(await slugs(undefined)).toEqual(["a", "d"]);
    expect(await slugs("active")).toEqual(["a"]);
    expect(await slugs("draft")).toEqual(["d"]);
    expect(await slugs("archived")).toEqual(["x"]);
    expect(await slugs("featured")).toEqual(["a"]);
    expect(await slugs("bogus")).toEqual(["a", "d"]);
  });
});
