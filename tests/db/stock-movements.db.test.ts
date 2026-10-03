import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { expectViolation, resetDatabaseBeforeEach, SQLSTATE, testDb } from "./client";
import { createAdmin, createOrder, createSimpleProduct } from "./fixtures";

// The stock_movements table (spec 0009, AC-11, AC-12): its CHECKs and the migration's backfill.

resetDatabaseBeforeEach();

async function setup() {
  const { variant } = await createSimpleProduct("1", 5);
  const admin = await createAdmin();
  const order = await createOrder();
  return { variant, admin, order };
}

describe("stock_movements CHECKs", () => {
  it("accepts one row of each kind with its actor", async () => {
    const { variant, admin, order } = await setup();

    await testDb.stockMovement.createMany({
      data: [
        {
          variantId: variant.id,
          kind: "initial",
          delta: 0,
          stockAfter: 0,
          actorType: "system",
        },
        {
          variantId: variant.id,
          kind: "adjustment",
          delta: 5,
          stockAfter: 5,
          actorType: "admin",
          adminId: admin.id,
          note: "Counted the shelf",
        },
        {
          variantId: variant.id,
          kind: "sale",
          delta: -2,
          stockAfter: 3,
          actorType: "system",
          orderId: order.id,
        },
      ],
    });

    expect(await testDb.stockMovement.count()).toBe(3);
  });

  it.each([
    [
      "a negative stock_after",
      { kind: "initial", delta: 0, stockAfter: -1, actorType: "system" },
      "stock_movements_stock_after_check",
    ],
    [
      "a change of 0 that is not an opening",
      { kind: "adjustment", delta: 0, stockAfter: 5, actorType: "admin", admin: true },
      "stock_movements_delta_check",
    ],
    [
      "an admin actor without an admin",
      { kind: "initial", delta: 1, stockAfter: 1, actorType: "admin" },
      "stock_movements_actor_check",
    ],
    [
      "an admin on a system row",
      { kind: "initial", delta: 1, stockAfter: 1, actorType: "system", admin: true },
      "stock_movements_actor_check",
    ],
    [
      "a sale without an order",
      { kind: "sale", delta: -1, stockAfter: 4, actorType: "system" },
      "stock_movements_sale_order_check",
    ],
    [
      "an order on something other than a sale",
      { kind: "initial", delta: 1, stockAfter: 1, actorType: "system", order: true },
      "stock_movements_sale_order_check",
    ],
    [
      "a sale by an admin",
      { kind: "sale", delta: -1, stockAfter: 4, actorType: "admin", admin: true, order: true },
      "stock_movements_sale_actor_check",
    ],
    [
      "an adjustment without an admin",
      { kind: "adjustment", delta: 1, stockAfter: 6, actorType: "system" },
      "stock_movements_adjustment_actor_check",
    ],
    [
      "a note on a sale",
      {
        kind: "sale",
        delta: -1,
        stockAfter: 4,
        actorType: "system",
        order: true,
        note: "Not allowed",
      },
      "stock_movements_note_check",
    ],
    [
      "a note over 200 characters",
      {
        kind: "adjustment",
        delta: 1,
        stockAfter: 6,
        actorType: "admin",
        admin: true,
        note: "x".repeat(201),
      },
      "stock_movements_note_check",
    ],
  ] as const)("refuses %s", async (_name, row, constraint) => {
    const { variant, admin, order } = await setup();
    const {
      admin: withAdmin,
      order: withOrder,
      ...columns
    } = row as typeof row & {
      admin?: boolean;
      order?: boolean;
    };

    await expectViolation(
      testDb.stockMovement.create({
        data: {
          ...columns,
          variantId: variant.id,
          adminId: withAdmin ? admin.id : null,
          orderId: withOrder ? order.id : null,
        },
      }),
      SQLSTATE.check,
      constraint,
    );
  });

  it("keeps an order with movements from being deleted, and goes with its variant", async () => {
    const { variant, order } = await setup();
    await testDb.stockMovement.create({
      data: {
        variantId: variant.id,
        kind: "sale",
        delta: -1,
        stockAfter: 4,
        actorType: "system",
        orderId: order.id,
      },
    });

    await expectViolation(
      testDb.order.delete({ where: { id: order.id } }),
      SQLSTATE.foreignKey,
      "stock_movements_order_id_fkey",
    );
    await testDb.orderLine.deleteMany();
    await testDb.stockMovement.deleteMany({ where: { kind: "sale" } });
    await testDb.stockMovement.create({
      data: {
        variantId: variant.id,
        kind: "initial",
        delta: 5,
        stockAfter: 5,
        actorType: "system",
      },
    });
    await testDb.productVariant.delete({ where: { id: variant.id } });
    expect(await testDb.stockMovement.count()).toBe(0);
  });
});

// The backfill statement exactly as the migration runs it, against variants that already exist.
function backfillStatement(): string {
  const dir = path.join(process.cwd(), "prisma/migrations");
  const folder = readdirSync(dir).find((name) => name.endsWith("_stock_movements"));
  if (!folder) throw new Error("No stock_movements migration");
  const sql = readFileSync(path.join(dir, folder, "migration.sql"), "utf8");
  const match = /INSERT INTO "stock_movements"[\s\S]*?FROM "product_variants";/.exec(sql);
  if (!match) throw new Error("No backfill INSERT in the stock_movements migration");
  return match[0];
}

describe("the migration's backfill", () => {
  it("gives every variant one initial system movement at its current stock, with v7 ids", async () => {
    const a = await createSimpleProduct("a", 7);
    const b = await createSimpleProduct("b", 0);

    await testDb.$executeRawUnsafe(backfillStatement());

    const rows = await testDb.stockMovement.findMany({
      select: {
        id: true,
        variantId: true,
        kind: true,
        delta: true,
        stockAfter: true,
        actorType: true,
      },
    });
    expect(
      rows.map((row) => ({
        variantId: row.variantId,
        kind: row.kind,
        delta: row.delta,
        stockAfter: row.stockAfter,
        actorType: row.actorType,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          variantId: a.variant.id,
          kind: "initial",
          delta: 7,
          stockAfter: 7,
          actorType: "system",
        },
        {
          variantId: b.variant.id,
          kind: "initial",
          delta: 0,
          stockAfter: 0,
          actorType: "system",
        },
      ]),
    );
    expect(rows).toHaveLength(2);
    for (const { id } of rows) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      // The first 48 bits are the time it ran, in milliseconds.
      const ms = Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16);
      expect(Math.abs(ms - Date.now())).toBeLessThan(60_000);
    }
  });
});
