import { describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createCustomer, createOrder, createSimpleProduct } from "./fixtures";

// The account order queries (spec 0012, AC-11 to AC-13) against a real Postgres.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { STORE_LOCALE: "en" } }));

const { getAccountOrder, listAccountOrders } = await import("@/features/account/queries");

resetDatabaseBeforeEach();

async function paidOrder(
  customerId: string | undefined,
  paidAt: Date,
  overrides: Parameters<typeof createOrder>[0] = {},
) {
  const order = await createOrder({ customerId, status: "paid", ...overrides });
  return testDb.order.update({ where: { id: order.id }, data: { paidAt } });
}

describe("listAccountOrders (AC-11)", () => {
  it("lists only this customer's paid orders, newest paid first, with item counts", async () => {
    const customer = await createCustomer();
    const other = await createCustomer();
    const { product, variant } = await createSimpleProduct("a", 5);
    const older = await paidOrder(customer.id, new Date("2026-10-01T10:00:00Z"));
    const newer = await paidOrder(customer.id, new Date("2026-10-05T10:00:00Z"), {
      status: "shipped",
    });
    const cancelled = await paidOrder(customer.id, new Date("2026-10-03T10:00:00Z"), {
      status: "cancelled",
    });
    await testDb.orderLine.createMany({
      data: [1, 2].map((quantity) => ({
        orderId: newer.id,
        variantId: variant.id,
        productId: product.id,
        productName: "Tee",
        sku: "SKU",
        unitPriceCents: 2500,
        quantity,
        lineTotalCents: 2500 * quantity,
      })),
    });
    // Hidden: pending, expired, cancelled before payment, and someone else's.
    await createOrder({ customerId: customer.id });
    await createOrder({ customerId: customer.id, status: "expired" });
    await createOrder({ customerId: customer.id, status: "cancelled" });
    await paidOrder(other.id, new Date());
    await paidOrder(undefined, new Date());

    const page = await listAccountOrders(customer.id, 1);

    expect(page.hasNext).toBe(false);
    expect(page.orders.map((order) => order.number)).toEqual([
      newer.number,
      cancelled.number,
      older.number,
    ]);
    expect(page.orders[0]).toMatchObject({ status: "shipped", itemCount: 3, currency: "EUR" });
  });

  it("pages 20 at a time and orders ties by id", async () => {
    const customer = await createCustomer();
    const sameMoment = new Date("2026-10-01T10:00:00Z");
    const orders = [];
    for (let i = 0; i < 21; i += 1) orders.push(await paidOrder(customer.id, sameMoment));

    const first = await listAccountOrders(customer.id, 1);
    const second = await listAccountOrders(customer.id, 2);

    expect(first.orders).toHaveLength(20);
    expect(first.hasNext).toBe(true);
    expect(second.orders).toHaveLength(1);
    expect(second.hasNext).toBe(false);
    // uuid v7 ids grow with time, so the newest created comes first among equal paid_at.
    expect(first.orders[0]!.number).toBe(orders[20]!.number);
    expect(second.orders[0]!.number).toBe(orders[0]!.number);
  });
});

describe("getAccountOrder (AC-12, AC-13)", () => {
  it("returns the customer's own paid order with its snapshot and address", async () => {
    const customer = await createCustomer();
    const order = await paidOrder(customer.id, new Date("2026-10-01T10:00:00Z"));
    await testDb.order.update({
      where: { id: order.id },
      data: {
        shipFullName: "Ada Lovelace",
        shipLine1: "1 Main St",
        shipPostalCode: "00-001",
        shipCity: "Warsaw",
        shipCountryCode: "PL",
        carrier: "InPost",
        trackingNumber: "TRACK1",
        refundedCents: 1000,
      },
    });

    const found = await getAccountOrder(customer.id, order.number);

    expect(found).toMatchObject({
      number: order.number,
      status: "paid",
      carrier: "InPost",
      trackingNumber: "TRACK1",
      refundedCents: 1000,
      address: { fullName: "Ada Lovelace", countryName: "Poland" },
    });
  });

  it("reads another customer's order, no one's, a hidden one and a missing one all as null", async () => {
    const customer = await createCustomer();
    const other = await createCustomer();
    const theirs = await paidOrder(other.id, new Date());
    const guest = await paidOrder(undefined, new Date());
    const pending = await createOrder({ customerId: customer.id });

    for (const number of [theirs.number, guest.number, pending.number, 99_999]) {
      expect(await getAccountOrder(customer.id, number)).toBeNull();
    }
  });
});
