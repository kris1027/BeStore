import { beforeEach, describe, expect, it, vi } from "vitest";

import { testDb, resetDatabaseBeforeEach } from "./client";
import {
  createAdmin,
  createOrder,
  createProductWithOptions,
  createSimpleProduct,
} from "./fixtures";

// The Images section against a real Postgres; Storage is stubbed (spec 0009, AC-13, AC-14,
// AC-21, AC-23).

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  updateTag: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  exists: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: { from: () => ({ exists: mocks.exists, remove: mocks.remove }) },
  }),
}));
vi.mock("@/lib/logger", async (importOriginal) =>
  (await import("./logger-mock")).mockLoggerModule(importOriginal, {
    info: mocks.info,
    warn: mocks.warn,
    error: vi.fn(),
  }),
);

const { updateProductImages } = await import("@/features/catalog/actions/update-images");

resetDatabaseBeforeEach();

let adminId = "";

beforeEach(async () => {
  vi.clearAllMocks();
  adminId = (await createAdmin()).id;
  mocks.requireAdmin.mockResolvedValue({ id: adminId, email: "admin@example.com", name: "Admin" });
  mocks.exists.mockResolvedValue({ data: true, error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null });
});

const path = (n: number) =>
  `products/0199a1b2-c3d4-7e5f-8a9b-0123456789${String(n).padStart(2, "0")}.png`;

async function addImages(productId: string, count: number, optionValueId: string | null = null) {
  for (let i = 0; i < count; i += 1) {
    await testDb.productImage.create({
      data: { productId, storagePath: path(i), altText: `Photo ${i}`, position: i, optionValueId },
    });
  }
}

async function loaded(productId: string) {
  return (
    await testDb.productImage.findMany({ where: { productId }, orderBy: { position: "asc" } })
  ).map((image) => ({
    id: image.id,
    altText: image.altText,
    position: image.position,
    optionValueId: image.optionValueId,
  }));
}

describe("updateProductImages", () => {
  it("reorders, edits, adds and removes in one save, then deletes the removed file", async () => {
    const { product, color } = await createProductWithOptions("t");
    await addImages(product.id, 3);
    const before = await loaded(product.id);
    const red = color.values.find((value) => value.value === "Red")!;

    const result = await updateProductImages({
      productId: product.id,
      loaded: before,
      images: [
        { id: before[2]!.id, altText: "Now first", optionValueId: red.id },
        { path: path(50), altText: "Fresh", width: 800, height: 1000, optionValueId: null },
        { id: before[0]!.id, altText: "Photo 0", optionValueId: null },
      ],
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(
      await testDb.productImage.findMany({
        orderBy: { position: "asc" },
        select: {
          storagePath: true,
          altText: true,
          position: true,
          optionValueId: true,
          width: true,
        },
      }),
    ).toEqual([
      {
        storagePath: path(2),
        altText: "Now first",
        position: 0,
        optionValueId: red.id,
        width: null,
      },
      { storagePath: path(50), altText: "Fresh", position: 1, optionValueId: null, width: 800 },
      { storagePath: path(0), altText: "Photo 0", position: 2, optionValueId: null, width: null },
    ]);
    expect(mocks.remove).toHaveBeenCalledWith([path(1)]);
    expect(mocks.updateTag.mock.calls.map(([tag]) => tag)).toEqual(["catalog", "product:tee-t"]);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "catalog.product.updated", adminId, productId: product.id, section: "images" },
      "catalog.product.updated",
    );
    // AC-24: never the alt text.
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("Fresh");
  });

  it("keeps a removed file an order line still shows", async () => {
    const { product } = await createSimpleProduct("1");
    await addImages(product.id, 2);
    const order = await createOrder();
    await testDb.orderLine.create({
      data: {
        orderId: order.id,
        productName: "Tee",
        sku: "X",
        imagePath: path(0),
        unitPriceCents: 5000,
        quantity: 1,
        lineTotalCents: 5000,
      },
    });
    const before = await loaded(product.id);

    await updateProductImages({ productId: product.id, loaded: before, images: [] });

    expect(await testDb.productImage.count()).toBe(0);
    expect(mocks.remove).toHaveBeenCalledWith([path(1)]);
  });

  it("logs a failed file delete without failing the save", async () => {
    const { product } = await createSimpleProduct("1");
    await addImages(product.id, 1);
    mocks.remove.mockResolvedValue({ data: null, error: { message: "boom" } });

    const result = await updateProductImages({
      productId: product.id,
      loaded: await loaded(product.id),
      images: [],
    });

    expect(result.ok).toBe(true);
    expect(mocks.warn).toHaveBeenCalledWith(
      {
        event: "catalog.images.file_delete_failed",
        adminId,
        productId: product.id,
        paths: [path(0)],
      },
      "catalog.images.file_delete_failed",
    );
  });

  it("refuses a 9th image", async () => {
    const { product } = await createSimpleProduct("1");

    const result = await updateProductImages({
      productId: product.id,
      loaded: [],
      images: Array.from({ length: 9 }, (_, i) => ({
        path: path(i),
        altText: "x",
        width: 1,
        height: 1,
        optionValueId: null,
      })),
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "validation", fields: { images: ["Up to 8 images."] } },
    });
  });

  it("refuses an image tied to another product's value", async () => {
    const { product } = await createSimpleProduct("1");
    const other = await createProductWithOptions("o");

    const result = await updateProductImages({
      productId: product.id,
      loaded: [],
      images: [
        {
          path: path(1),
          altText: "x",
          width: 1,
          height: 1,
          optionValueId: other.color.values[0]!.id,
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        fields: { "images.0.optionValueId": ["Choose a value this product has."] },
      },
    });
    expect(await testDb.productImage.count()).toBe(0);
  });

  it("refuses a path another image uses, and an upload that never finished", async () => {
    const { product } = await createSimpleProduct("1");
    const other = await createSimpleProduct("2");
    await addImages(other.product.id, 1);
    const fresh = { altText: "x", width: 1, height: 1, optionValueId: null };

    expect(
      await updateProductImages({
        productId: product.id,
        loaded: [],
        images: [{ ...fresh, path: path(0) }],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "validation",
        fields: { "images.0": ["This image is already used. Choose it again."] },
      },
    });

    mocks.exists.mockResolvedValue({ data: false, error: null });
    expect(
      await updateProductImages({
        productId: product.id,
        loaded: [],
        images: [{ ...fresh, path: path(9) }],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "validation",
        fields: { "images.0": ["The image did not finish uploading. Choose it again."] },
      },
    });
  });

  it("refuses a save over another admin's change, writing nothing", async () => {
    const { product } = await createSimpleProduct("1");
    await addImages(product.id, 2);
    const before = await loaded(product.id);
    await testDb.productImage.update({ where: { id: before[0]!.id }, data: { altText: "Theirs" } });

    const result = await updateProductImages({
      productId: product.id,
      loaded: before,
      images: [{ id: before[1]!.id, altText: "Mine", optionValueId: null }],
    });

    expect(result).toEqual({ ok: false, error: { code: "stale" } });
    expect(await testDb.productImage.count()).toBe(2);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
