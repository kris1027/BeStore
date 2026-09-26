import { beforeEach, describe, expect, it, vi } from "vitest";

import { testDb, resetDatabaseBeforeEach } from "./client";

// createProduct against a real Postgres: one transaction, and nothing written on any refusal
// (spec 0005, AC-3, AC-4, AC-15, AC-18).

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  updateTag: vi.fn(),
  info: vi.fn(),
  exists: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: { STORE_CURRENCY: "EUR", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" },
}));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ storage: { from: () => ({ exists: mocks.exists }) } }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: vi.fn() } }));

const { createProduct } = await import("@/features/catalog/actions/create-product");

resetDatabaseBeforeEach();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin-1", email: "a@example.com", name: "Ada" });
});

const simple = {
  name: "Linen shirt",
  slug: "linen-shirt",
  description: "Soft.",
  optionTypes: [],
  variants: [{ values: [], price: "19.99", stock: "3", sku: "linen-shirt" }],
};

const withOptions = {
  name: "Tee",
  slug: "tee",
  description: "",
  optionTypes: [
    { name: "Size", values: ["S", "M"] },
    { name: "Color", values: ["Red", "Blue"] },
  ],
  variants: [
    { values: ["S", "Red"], price: "10", stock: "1", sku: "TEE-S-RED" },
    { values: ["S", "Blue"], price: "10", stock: "0", sku: "TEE-S-BLUE" },
    { values: ["M", "Red"], price: "12", stock: "4", sku: "TEE-M-RED" },
    { values: ["M", "Blue"], price: "12", stock: "9", sku: "TEE-M-BLUE" },
  ],
};

async function counts() {
  const [products, variants, types, values, links] = await Promise.all([
    testDb.product.count(),
    testDb.productVariant.count(),
    testDb.productOptionType.count(),
    testDb.productOptionValue.count(),
    testDb.variantOptionValue.count(),
  ]);
  return { products, variants, types, values, links };
}

describe("createProduct", () => {
  it("writes a simple product with its default variant, expires its tags and logs", async () => {
    const result = await createProduct(simple, "active");

    expect(result).toEqual({
      ok: true,
      data: { productId: expect.any(String), slug: "linen-shirt" },
    });
    const product = await testDb.product.findUniqueOrThrow({
      where: { slug: "linen-shirt" },
      include: { variants: true },
    });
    expect(product).toMatchObject({ name: "Linen shirt", description: "Soft.", status: "active" });
    expect(product.variants).toEqual([
      expect.objectContaining({
        sku: "LINEN-SHIRT",
        priceCents: 1999,
        stockQuantity: 3,
        position: 0,
        optionKey: "",
      }),
    ]);
    expect(mocks.updateTag).toHaveBeenCalledWith("catalog");
    expect(mocks.updateTag).toHaveBeenCalledWith("product:linen-shirt");
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: "catalog.product.created",
        adminId: "admin-1",
        productId: product.id,
        status: "active",
      },
      "catalog.product.created",
    );
  });

  it("writes option types, values, variants and their links in grid order", async () => {
    const result = await createProduct(withOptions, "draft");
    expect(result.ok).toBe(true);

    const product = await testDb.product.findUniqueOrThrow({
      where: { slug: "tee" },
      include: {
        optionTypes: {
          orderBy: { position: "asc" },
          include: { values: { orderBy: { position: "asc" } } },
        },
        variants: { orderBy: { position: "asc" }, include: { optionValues: true } },
      },
    });
    expect(product.status).toBe("draft");
    expect(product.optionTypes.map((t) => [t.name, t.values.map((v) => v.value)])).toEqual([
      ["Size", ["S", "M"]],
      ["Color", ["Red", "Blue"]],
    ]);
    const idOf = new Map(product.optionTypes.flatMap((t) => t.values.map((v) => [v.value, v.id])));
    expect(product.variants.map((v) => v.sku)).toEqual([
      "TEE-S-RED",
      "TEE-S-BLUE",
      "TEE-M-RED",
      "TEE-M-BLUE",
    ]);
    for (const [variant, [size, color]] of product.variants.map(
      (v, i) => [v, withOptions.variants[i]!.values] as const,
    )) {
      const ids = [idOf.get(size!)!, idOf.get(color!)!];
      expect(variant.optionKey).toBe([...ids].sort().join(","));
      expect(variant.optionValues.map((link) => link.optionValueId).sort()).toEqual(
        [...ids].sort(),
      );
    }
  });

  it("refuses a slug or SKU already in the database on its field, writing nothing", async () => {
    await createProduct(simple, "active");
    const before = await counts();

    const result = await createProduct(
      {
        ...simple,
        name: "Another shirt",
        variants: [{ ...simple.variants[0]!, sku: "Linen-Shirt" }],
      },
      "active",
    );

    expect(result).toEqual({
      ok: false,
      error: {
        fields: {
          slug: ["Another product already uses this URL name."],
          "variants.0.sku": ["Another product already uses this SKU."],
        },
      },
    });
    expect(await counts()).toEqual(before);
  });

  it("refuses invalid input with field errors and writes nothing", async () => {
    const result = await createProduct(
      { ...simple, variants: [{ ...simple.variants[0]!, price: "1.999" }] },
      "active",
    );

    expect(result).toEqual({
      ok: false,
      error: {
        fields: { "variants.0.price": ["This currency does not have that many decimals."] },
      },
    });
    expect(await counts()).toEqual({ products: 0, variants: 0, types: 0, values: 0, links: 0 });
  });

  describe("with an image", () => {
    const path = "products/0199a1b2-c3d4-7e5f-8a9b-0123456789ab.png";
    const image = { path, altText: "A mug", width: 400, height: 500 };

    it("writes the image row after confirming the upload exists", async () => {
      mocks.exists.mockResolvedValue({ data: true, error: null });

      expect((await createProduct({ ...simple, image }, "active")).ok).toBe(true);

      expect(mocks.exists).toHaveBeenCalledWith(path);
      expect(await testDb.productImage.findFirstOrThrow()).toMatchObject({
        storagePath: path,
        altText: "A mug",
        width: 400,
        height: 500,
        position: 0,
        optionValueId: null,
      });
    });

    it("refuses an upload that never landed and writes nothing", async () => {
      mocks.exists.mockResolvedValue({ data: false, error: null });

      expect(await createProduct({ ...simple, image }, "active")).toEqual({
        ok: false,
        error: { fields: { image: ["The image did not finish uploading. Choose it again."] } },
      });
      expect(await counts()).toEqual({ products: 0, variants: 0, types: 0, values: 0, links: 0 });
    });

    it.each([
      "products/../secret.png",
      "other/0199a1b2-c3d4-7e5f-8a9b-0123456789ab.png",
      "products/0199a1b2-c3d4-4e5f-8a9b-0123456789ab.png",
      "products/0199a1b2-c3d4-7e5f-8a9b-0123456789ab.gif",
    ])("refuses the forged path %s without asking Storage", async (forged) => {
      const result = await createProduct(
        { ...simple, image: { ...image, path: forged } },
        "active",
      );

      expect(result).toEqual({
        ok: false,
        error: { fields: { "image.path": ["Choose the image again."] } },
      });
      expect(mocks.exists).not.toHaveBeenCalled();
    });

    it("requires alt text", async () => {
      const result = await createProduct(
        { ...simple, image: { ...image, altText: " " } },
        "active",
      );

      expect(result).toEqual({
        ok: false,
        error: {
          fields: { "image.altText": ["Describe the image for people who cannot see it."] },
        },
      });
    });
  });

  it("refuses any status but the two buttons", async () => {
    expect(await createProduct(simple, "archived")).toEqual({
      ok: false,
      error: { form: "unavailable" },
    });
    expect(await testDb.product.count()).toBe(0);
  });

  it("checks for an admin before anything else", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(createProduct(simple, "active")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await testDb.product.count()).toBe(0);
  });
});
