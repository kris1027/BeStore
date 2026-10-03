import { beforeEach, describe, expect, it, vi } from "vitest";

import { testDb, resetDatabaseBeforeEach } from "./client";
import { createAdmin, createProductWithOptions, createSimpleProduct } from "./fixtures";
import { seedPendingOrder } from "./stripe-support";

// The Stock section and its history against a real Postgres (spec 0009, AC-10, AC-11, AC-24).

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  updateTag: vi.fn(),
  info: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" } }));
vi.mock("next/cache", () => ({ updateTag: mocks.updateTag }));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/logger", async (importOriginal) =>
  (await import("./logger-mock")).mockLoggerModule(importOriginal, {
    info: mocks.info,
    warn: vi.fn(),
    error: vi.fn(),
  }),
);

const { adjustStock } = await import("@/features/catalog/actions/adjust-stock");
const { getStockHistory } = await import("@/features/catalog/admin-queries");
const { markPaid } = await import("@/lib/orders/transitions");

resetDatabaseBeforeEach();

let adminId = "";

beforeEach(async () => {
  vi.clearAllMocks();
  adminId = (await createAdmin()).id;
  mocks.requireAdmin.mockResolvedValue({ id: adminId, email: "admin@example.com", name: "Admin" });
});

async function stockOf(variantId: string) {
  return (await testDb.productVariant.findUniqueOrThrow({ where: { id: variantId } }))
    .stockQuantity;
}

async function pay(orderId: string) {
  await testDb.$transaction((tx) =>
    markPaid(tx, {
      orderId,
      paidAt: new Date(),
      paymentIntentId: null,
      amountTotal: null,
      currency: null,
    }),
  );
}

describe("adjustStock", () => {
  it("sets each changed row, writes an adjustment with the note, and skips the rest", async () => {
    const { product, variants } = await createProductWithOptions("t");
    const [first, second] = variants;

    const result = await adjustStock({
      productId: product.id,
      rows: [
        { variantId: first!.id, expected: 3, next: "10", note: "  Delivery from the mill " },
        { variantId: second!.id, expected: 3, next: "3", note: "dropped" },
      ],
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(await stockOf(first!.id)).toBe(10);
    expect(await stockOf(second!.id)).toBe(3);
    expect(
      await testDb.stockMovement.findMany({
        select: {
          variantId: true,
          kind: true,
          delta: true,
          stockAfter: true,
          actorType: true,
          adminId: true,
          note: true,
        },
      }),
    ).toEqual([
      {
        variantId: first!.id,
        kind: "adjustment",
        delta: 7,
        stockAfter: 10,
        actorType: "admin",
        adminId,
        note: "Delivery from the mill",
      },
    ]);
    expect(mocks.updateTag.mock.calls.map(([tag]) => tag)).toEqual(["catalog", "product:tee-t"]);
    // AC-24: ids and counts, never the note.
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: "catalog.stock.adjusted",
        adminId,
        productId: product.id,
        variantId: first!.id,
        before: 3,
        after: 10,
      },
      "catalog.stock.adjusted",
    );
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("mill");
  });

  it("refuses the whole save when a sale moved a row since the page loaded", async () => {
    const { order, variant, product } = await seedPendingOrder({ stock: 5, quantity: 1 });
    const other = await testDb.productVariant.create({
      data: {
        productId: product.id,
        sku: "OTHER",
        priceCents: 100,
        stockQuantity: 2,
        position: 1,
        optionKey: "x",
      },
    });
    // The page showed 5; a customer pays for 1 while the admin types.
    await pay(order.id);

    const result = await adjustStock({
      productId: product.id,
      rows: [
        { variantId: variant.id, expected: 5, next: "8", note: "" },
        { variantId: other.id, expected: 2, next: "4", note: "" },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "moved", rows: [{ variantId: variant.id, now: 4, archived: false }] },
    });
    expect(await stockOf(variant.id)).toBe(4);
    expect(await stockOf(other.id)).toBe(2);
    expect(await testDb.stockMovement.count({ where: { kind: "adjustment" } })).toBe(0);
    expect(mocks.updateTag).not.toHaveBeenCalled();

    // Saving again against the count it has now works.
    const retry = await adjustStock({
      productId: product.id,
      rows: [{ variantId: variant.id, expected: 4, next: "8", note: "" }],
    });
    expect(retry.ok).toBe(true);
    expect(await stockOf(variant.id)).toBe(8);
  });

  it("refuses a row whose variant was archived meanwhile", async () => {
    const { product, variant } = await createSimpleProduct("1", 5);
    await testDb.productVariant.update({ where: { id: variant.id }, data: { archived: true } });

    const result = await adjustStock({
      productId: product.id,
      rows: [{ variantId: variant.id, expected: 5, next: "6", note: "" }],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "moved", rows: [{ variantId: variant.id, now: 5, archived: true }] },
    });
  });

  it("lets exactly one of two saves from the same count win", async () => {
    const { product, variant } = await createSimpleProduct("1", 5);
    const save = (next: string) =>
      adjustStock({
        productId: product.id,
        rows: [{ variantId: variant.id, expected: 5, next, note: "" }],
      });

    const results = await Promise.all([save("7"), save("9")]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const refused = results.find((result) => !result.ok);
    expect(refused).toMatchObject({ ok: false, error: { code: "moved" } });
    const now = await stockOf(variant.id);
    expect([7, 9]).toContain(now);
    expect(await testDb.stockMovement.findMany({ select: { stockAfter: true } })).toEqual([
      { stockAfter: now },
    ]);
  });

  it("answers validation errors by row, and nothing changes", async () => {
    const { product, variant } = await createSimpleProduct("1", 5);

    const result = await adjustStock({
      productId: product.id,
      rows: [{ variantId: variant.id, expected: 5, next: "-1", note: "x".repeat(201) }],
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.error.code !== "validation") throw new Error("expected validation");
    expect(Object.keys(result.error.fields).sort()).toEqual(["rows.0.next", "rows.0.note"]);
    expect(await stockOf(variant.id)).toBe(5);
  });

  it("refuses a variant of another product as moved, never touching it", async () => {
    const { product } = await createSimpleProduct("1", 5);
    const other = await createSimpleProduct("2", 5);

    const result = await adjustStock({
      productId: product.id,
      rows: [{ variantId: other.variant.id, expected: 5, next: "1", note: "" }],
    });

    expect(result).toMatchObject({ ok: false, error: { code: "moved" } });
    expect(await stockOf(other.variant.id)).toBe(5);
  });
});

describe("getStockHistory", () => {
  it("lists the latest movements newest first, with who and the variant label", async () => {
    const { order, variant, product } = await seedPendingOrder({ stock: 5, quantity: 2 });
    await testDb.stockMovement.create({
      data: {
        variantId: variant.id,
        kind: "initial",
        delta: 5,
        stockAfter: 5,
        actorType: "system",
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await pay(order.id);
    await adjustStock({
      productId: product.id,
      rows: [{ variantId: variant.id, expected: 3, next: "6", note: "Found a box" }],
    });
    // Disabled admins keep their name in the history.
    await testDb.adminUser.update({ where: { id: adminId }, data: { disabledAt: new Date() } });

    const history = await getStockHistory(product.id);

    expect(
      history.map((row) => [
        row.kind,
        row.delta,
        row.stockAfter,
        row.actor,
        row.note,
        row.variantLabel,
      ]),
    ).toEqual([
      ["adjustment", 3, 6, { type: "admin", name: "Admin" }, "Found a box", "Default"],
      ["sale", -2, 3, { type: "order", number: order.number }, null, "Default"],
      ["initial", 5, 5, { type: "system" }, null, "Default"],
    ]);
  });

  it("labels variants by their values and stops at 50 rows", async () => {
    const { product, variants } = await createProductWithOptions("t");
    await testDb.stockMovement.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        variantId: variants[0]!.id,
        kind: "initial" as const,
        delta: i,
        stockAfter: i,
        actorType: "system" as const,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    });

    const history = await getStockHistory(product.id);

    expect(history).toHaveLength(50);
    expect(history[0]).toMatchObject({ delta: 54, variantLabel: "S / Red" });
  });
});
