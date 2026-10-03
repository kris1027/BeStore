import { beforeEach, describe, expect, it, vi } from "vitest";

import { testDb, resetDatabaseBeforeEach } from "./client";
import {
  createAdmin,
  createOrder,
  createProductWithOptions as createRawProduct,
  createSimpleProduct,
  holding,
} from "./fixtures";

// The Variants section and adding an option value against a real Postgres (spec 0009, AC-7 to
// AC-9, AC-11, AC-21, AC-23, AC-24).

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  updateTag: vi.fn(),
  info: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { STORE_CURRENCY: "EUR" } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() } }));

const { updateVariants } = await import("@/features/catalog/actions/update-variants");
const { addOptionValue } = await import("@/features/catalog/actions/add-option-value");

resetDatabaseBeforeEach();

// The fixture's SKUs keep their case; the app stores them upper cased, as the form sends them.
async function createProductWithOptions(suffix: string) {
  const created = await createRawProduct(suffix);
  await testDb.$executeRaw`UPDATE product_variants SET sku = upper(sku)`;
  return created;
}

let adminId = "";

beforeEach(async () => {
  vi.clearAllMocks();
  adminId = (await createAdmin()).id;
  mocks.requireAdmin.mockResolvedValue({ id: adminId, email: "admin@example.com", name: "Admin" });
});

// What the Variants form sends for a product as stored now, with optional edits per row.
async function variantsInput(
  productId: string,
  edit: {
    readonly rows?: Record<
      number,
      Partial<{ price: string; compareAt: string; sku: string; archived: boolean }>
    >;
    readonly names?: (types: { name: string; values: string[] }[]) => void;
  } = {},
) {
  const product = await testDb.product.findUniqueOrThrow({
    where: { id: productId },
    include: {
      variants: { orderBy: { position: "asc" } },
      optionTypes: {
        orderBy: { position: "asc" },
        include: { values: { orderBy: { position: "asc" } } },
      },
    },
  });
  const names = product.optionTypes.map((type) => ({
    name: type.name,
    values: type.values.map((value) => value.value),
  }));
  edit.names?.(names);
  return {
    productId,
    rows: product.variants.map((variant, index) => ({
      variantId: variant.id,
      loaded: {
        price: variant.priceCents,
        compareAt: variant.compareAtPriceCents,
        sku: variant.sku,
        archived: variant.archived,
      },
      price: (variant.priceCents / 100).toFixed(2),
      compareAt:
        variant.compareAtPriceCents === null ? "" : (variant.compareAtPriceCents / 100).toFixed(2),
      sku: variant.sku,
      archived: variant.archived,
      ...edit.rows?.[index],
    })),
    optionNames: product.optionTypes.map((type, t) => ({
      typeId: type.id,
      loadedName: type.name,
      name: names[t]!.name,
      values: type.values.map((value, v) => ({
        valueId: value.id,
        loadedValue: value.value,
        value: names[t]!.values[v]!,
      })),
    })),
  };
}

describe("updateVariants", () => {
  it("saves prices, a compare at price, a SKU and an archive flag, then expires and logs", async () => {
    const { product, variants } = await createProductWithOptions("t");

    const result = await updateVariants(
      await variantsInput(product.id, {
        rows: {
          0: { price: "25", compareAt: "40" },
          1: { sku: "tee-s-blue-2" },
          2: { archived: true },
        },
      }),
    );

    expect(result).toEqual({ ok: true, data: null });
    const stored = await testDb.productVariant.findMany({ orderBy: { position: "asc" } });
    expect(stored[0]).toMatchObject({
      id: variants[0]!.id,
      priceCents: 2500,
      compareAtPriceCents: 4000,
    });
    expect(stored[1]).toMatchObject({ sku: "TEE-S-BLUE-2" });
    expect(stored[2]).toMatchObject({ archived: true });
    expect(stored[3]).toMatchObject({ priceCents: 3000, archived: false });
    expect(mocks.updateTag.mock.calls.map(([tag]) => tag)).toEqual(["catalog", "product:tee-t"]);
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "catalog.product.updated", adminId, productId: product.id, section: "variants" },
      "catalog.product.updated",
    );
  });

  it("refuses a compare at price at or below the price", async () => {
    const { product } = await createProductWithOptions("t");

    const result = await updateVariants(
      await variantsInput(product.id, { rows: { 0: { price: "30", compareAt: "30" } } }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        fields: { "rows.0.compareAt": ["Enter a price above the selling price."] },
      },
    });
  });

  it("renames an option type and a value, keeping every option_key", async () => {
    const { product, size } = await createProductWithOptions("t");
    const keys = (await testDb.productVariant.findMany({ orderBy: { position: "asc" } })).map(
      (variant) => variant.optionKey,
    );

    const result = await updateVariants(
      await variantsInput(product.id, {
        names: (types) => {
          types[0]!.name = "Fit";
          types[0]!.values[0] = "Small";
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(
      await testDb.productOptionType.findUniqueOrThrow({ where: { id: size.id } }),
    ).toMatchObject({
      name: "Fit",
    });
    expect(
      (
        await testDb.productOptionValue.findMany({
          where: { optionTypeId: size.id },
          orderBy: { position: "asc" },
        })
      ).map((value) => value.value),
    ).toEqual(["Small", "M"]);
    expect(
      (await testDb.productVariant.findMany({ orderBy: { position: "asc" } })).map(
        (v) => v.optionKey,
      ),
    ).toEqual(keys);
  });

  it("refuses a swap of two value names", async () => {
    const { product } = await createProductWithOptions("t");

    const result = await updateVariants(
      await variantsInput(product.id, {
        names: (types) => {
          types[0]!.values = ["M", "S"];
        },
      }),
    );

    expect(result).toEqual({ ok: false, error: { code: "rename_swap" } });
  });

  it("refuses duplicate names case insensitively, as on create", async () => {
    const { product } = await createProductWithOptions("t");

    const result = await updateVariants(
      await variantsInput(product.id, {
        names: (types) => {
          types[1]!.name = "size";
          types[0]!.values[1] = "s";
        },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "validation",
        fields: {
          "optionNames.1.name": ["This option is already there."],
          "optionNames.0.values.1.value": ["This value is already there."],
        },
      },
    });
  });

  it("refuses a SKU another product uses", async () => {
    const { product } = await createProductWithOptions("t");
    await createSimpleProduct("X");

    const result = await updateVariants(
      await variantsInput(product.id, { rows: { 1: { sku: "sku-x" } } }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "sku_taken",
        fields: { "rows.1.sku": ["Another variant already uses this SKU."] },
      },
    });
  });

  it("refuses a save over another admin's change to an edited row, writing nothing", async () => {
    const { product, variants } = await createProductWithOptions("t");
    const stale = await variantsInput(product.id, {
      rows: { 0: { price: "11" }, 1: { price: "12" } },
    });
    await testDb.productVariant.update({
      where: { id: variants[1]!.id },
      data: { priceCents: 9900 },
    });

    const result = await updateVariants(stale);

    expect(result).toEqual({ ok: false, error: { code: "stale" } });
    expect(
      (await testDb.productVariant.findUniqueOrThrow({ where: { id: variants[0]!.id } }))
        .priceCents,
    ).toBe(3000);
  });

  it("is not refused by a sale, or by a change to a row it does not edit", async () => {
    const { product, variants } = await createProductWithOptions("t");
    const input = await variantsInput(product.id, { rows: { 0: { price: "11" } } });
    await testDb.$executeRaw`
      UPDATE product_variants SET stock_quantity = stock_quantity - 1, updated_at = now()
      WHERE id = ${variants[0]!.id}::uuid`;
    await testDb.productVariant.update({
      where: { id: variants[3]!.id },
      data: { priceCents: 9900 },
    });

    expect((await updateVariants(input)).ok).toBe(true);
  });

  it("refuses archiving the last variant of a live product, but not of a draft", async () => {
    const { product, variant } = await createSimpleProduct("1");

    expect(
      await updateVariants(await variantsInput(product.id, { rows: { 0: { archived: true } } })),
    ).toEqual({ ok: false, error: { code: "last_variant" } });

    await testDb.product.update({ where: { id: product.id }, data: { status: "draft" } });
    expect(
      (await updateVariants(await variantsInput(product.id, { rows: { 0: { archived: true } } })))
        .ok,
    ).toBe(true);
    expect(
      (await testDb.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).archived,
    ).toBe(true);
  });

  it("changes nothing and expires nothing when nothing was edited", async () => {
    const { product } = await createProductWithOptions("t");

    expect(await updateVariants(await variantsInput(product.id))).toEqual({ ok: true, data: null });
    expect(mocks.updateTag).not.toHaveBeenCalled();
  });

  it("does not deadlock with a checkout holding the variant whose SKU it changes", async () => {
    const { product, variant } = await createSimpleProduct("1");
    const order = await createOrder();

    // startCheckout: FOR KEY SHARE on the variant, then an order line whose foreign key needs a
    // key share on the product row.
    const checkout = holding(
      (tx) =>
        tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${variant.id}::uuid FOR KEY SHARE`,
      (tx) =>
        tx.orderLine.create({
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
        }),
    );
    await checkout.locked;

    const saving = updateVariants(
      await variantsInput(product.id, { rows: { 0: { sku: "SKU-1-NEW" } } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    checkout.release();

    await expect(checkout.done).resolves.toBeDefined();
    expect(await saving).toEqual({ ok: true, data: null });
  });

  it("updates rows in id order, so it does not deadlock with a paid order taking stock", async () => {
    const { product, variants } = await createProductWithOptions("t");
    const [low, high] = [...variants].sort((a, b) => (a.id < b.id ? -1 : 1));
    const input = await variantsInput(product.id);
    const edited = {
      ...input,
      // The form sends rows in display order; put the higher id first.
      rows: input.rows
        .filter((row) => row.variantId === low!.id || row.variantId === high!.id)
        .sort((a) => (a.variantId === high!.id ? -1 : 1))
        .map((row) => ({ ...row, price: "33" })),
    };

    // markPaid: takeStock locks each line's variant in id order.
    const paid = holding(
      (tx) => tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${low!.id}::uuid FOR UPDATE`,
      (tx) => tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${high!.id}::uuid FOR UPDATE`,
    );
    await paid.locked;

    const saving = updateVariants(edited);
    await new Promise((resolve) => setTimeout(resolve, 300));
    paid.release();

    await expect(paid.done).resolves.toBeDefined();
    expect(await saving).toEqual({ ok: true, data: null });
  });
});

describe("addOptionValue", () => {
  function row(otherValueIds: string[], sku: string, stock = "2") {
    return { otherValueIds, price: "35", compareAt: "", stock, sku };
  }

  it("adds the value last and only the new combinations, each with an opening movement", async () => {
    const { product, size, color, variants } = await createProductWithOptions("t");
    const [s, m] = size.values.toSorted((a, b) => a.position - b.position);

    const result = await addOptionValue({
      productId: product.id,
      optionTypeId: color.id,
      value: "Oat",
      newVariants: [row([s!.id], "TEE-S-OAT", "0"), row([m!.id], "TEE-M-OAT", "4")],
    });

    expect(result.ok).toBe(true);
    const oat = await testDb.productOptionValue.findFirstOrThrow({ where: { value: "Oat" } });
    expect(oat).toMatchObject({ optionTypeId: color.id, position: 2 });
    const stored = await testDb.productVariant.findMany({ orderBy: { position: "asc" } });
    expect(stored.map((v) => v.id).slice(0, 4)).toEqual(variants.map((v) => v.id));
    expect(stored.slice(4).map((v) => [v.sku, v.position, v.stockQuantity, v.optionKey])).toEqual([
      ["TEE-S-OAT", 4, 0, [s!.id, oat.id].toSorted().join(",")],
      ["TEE-M-OAT", 5, 4, [m!.id, oat.id].toSorted().join(",")],
    ]);
    expect(
      await testDb.stockMovement.findMany({
        orderBy: { variant: { position: "asc" } },
        select: { kind: true, delta: true, stockAfter: true, adminId: true },
      }),
    ).toEqual([
      { kind: "initial", delta: 0, stockAfter: 0, adminId },
      { kind: "initial", delta: 4, stockAfter: 4, adminId },
    ]);
    expect(mocks.updateTag.mock.calls.map(([tag]) => tag)).toEqual(["catalog", "product:tee-t"]);
  });

  it("refuses rows that are not exactly the missing combinations", async () => {
    const { product, size, color } = await createProductWithOptions("t");
    const [s] = size.values;

    const result = await addOptionValue({
      productId: product.id,
      optionTypeId: color.id,
      value: "Oat",
      newVariants: [row([s!.id], "TEE-S-OAT")],
    });

    expect(result).toEqual({ ok: false, error: { code: "stale" } });
    expect(await testDb.productOptionValue.count({ where: { value: "Oat" } })).toBe(0);
  });

  it("refuses a value the type already has, in any case", async () => {
    const { product, size, color } = await createProductWithOptions("t");

    const result = await addOptionValue({
      productId: product.id,
      optionTypeId: color.id,
      value: "red",
      newVariants: size.values.map((value) => row([value.id], `TEE-${value.value}-RED2`)),
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "validation", fields: { value: ["This value is already there."] } },
    });
  });

  it("refuses an 11th value", async () => {
    const product = await testDb.product.create({ data: { name: "Ring", slug: "ring" } });
    const type = await testDb.productOptionType.create({
      data: {
        productId: product.id,
        name: "Size",
        position: 0,
        values: { create: Array.from({ length: 10 }, (_, i) => ({ value: `${i}`, position: i })) },
      },
    });

    const result = await addOptionValue({
      productId: product.id,
      optionTypeId: type.id,
      value: "10",
      newVariants: [row([], "RING-10")],
    });

    expect(result).toEqual({ ok: false, error: { code: "too_many_values" } });
  });

  it("refuses more than 100 variants, archived ones included", async () => {
    const product = await testDb.product.create({ data: { name: "Grid", slug: "grid" } });
    const a = await testDb.productOptionType.create({
      data: {
        productId: product.id,
        name: "A",
        position: 0,
        values: { create: Array.from({ length: 10 }, (_, i) => ({ value: `a${i}`, position: i })) },
      },
      include: { values: true },
    });
    const b = await testDb.productOptionType.create({
      data: {
        productId: product.id,
        name: "B",
        position: 1,
        values: { create: Array.from({ length: 9 }, (_, i) => ({ value: `b${i}`, position: i })) },
      },
      include: { values: true },
    });
    // 91 variants, 11 of them archived: a 10th B value needs 10 more, 101 in all.
    let position = 0;
    for (const va of a.values) {
      for (const vb of b.values) {
        await testDb.productVariant.create({
          data: {
            productId: product.id,
            sku: `G-${va.value}-${vb.value}`,
            priceCents: 100,
            position: position++,
            archived: position <= 10,
            optionKey: [va.id, vb.id].toSorted().join(","),
          },
        });
      }
    }
    await testDb.productVariant.create({
      data: {
        productId: product.id,
        sku: "G-EXTRA",
        priceCents: 100,
        position: position++,
        archived: true,
        optionKey: "extra",
      },
    });

    const result = await addOptionValue({
      productId: product.id,
      optionTypeId: b.id,
      value: "b9",
      newVariants: a.values.map((value) => row([value.id], `G-${value.value}-B9`)),
    });

    expect(result).toEqual({ ok: false, error: { code: "too_many_variants" } });
  });

  it("refuses a SKU another variant uses, by row", async () => {
    const { product, size, color } = await createProductWithOptions("t");
    const [s, m] = size.values.toSorted((x, y) => x.position - y.position);
    await createSimpleProduct("X");

    const result = await addOptionValue({
      productId: product.id,
      optionTypeId: color.id,
      value: "Oat",
      newVariants: [row([s!.id], "TEE-S-OAT"), row([m!.id], "sku-x")],
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "sku_taken",
        fields: { "newVariants.1.sku": ["Another variant already uses this SKU."] },
      },
    });
  });

  it("cannot add a value to a product without options", async () => {
    const { product } = await createSimpleProduct("1");

    const result = await addOptionValue({
      productId: product.id,
      optionTypeId: "01890000-0000-7000-8000-000000000000",
      value: "Big",
      newVariants: [row([], "BIG")],
    });

    expect(result).toEqual({ ok: false, error: { code: "stale" } });
  });
});
