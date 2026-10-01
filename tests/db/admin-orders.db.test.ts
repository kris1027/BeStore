import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createOrder } from "./fixtures";
import { seedPendingOrder } from "./stripe-support";

// The admin order list and detail queries (spec 0006, AC-12 and AC-13). The pages' requireAdmin()
// and the proxy 404 are covered by the e2e denial tests.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { STRIPE_SECRET_KEY: "sk_test_abc" } }));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { stripeDashboardUrl: actual.stripeDashboardUrl };
});
vi.mock("stripe", () => ({ default: class {} }));

const mocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: mocks.error } }));

const { getAdminOrder, getAdminOrders, parseAdminOrdersParams } =
  await import("@/features/orders/admin-queries");

resetDatabaseBeforeEach();

beforeEach(() => vi.clearAllMocks());

// spec 0008: what the daily purge leaves on an expired order.
async function purgedOrder() {
  const order = await createOrder({ status: "expired", email: "ada@example.com" });
  return testDb.order.update({
    where: { id: order.id },
    data: {
      email: null,
      shipFullName: null,
      shipCity: null,
      piiPurgedAt: new Date("2026-09-01T04:00:00Z"),
    },
  });
}

describe("getAdminOrders", () => {
  it("shows paid and later orders by default, and every order in the all view", async () => {
    for (const status of [
      "pending_payment",
      "paid",
      "shipped",
      "delivered",
      "cancelled",
      "expired",
    ] as const) {
      await createOrder({ status });
    }

    const settled = await getAdminOrders({ all: false, before: null });
    const all = await getAdminOrders({ all: true, before: null });

    expect(settled.rows.map((row) => row.status)).toEqual([
      "cancelled",
      "delivered",
      "shipped",
      "paid",
    ]);
    expect(all.rows).toHaveLength(6);
  });

  it("pages 50 at a time, newest first, by order number", async () => {
    for (let i = 0; i < 55; i += 1) await createOrder({ status: "paid" });

    const first = await getAdminOrders({ all: false, before: null });
    const second = await getAdminOrders({ all: false, before: first.olderBefore });

    expect(first.rows).toHaveLength(50);
    expect(first.rows[0]?.number).toBe(1055);
    expect(first.olderBefore).toBe(1006);
    expect(second.rows.map((row) => row.number)).toEqual([1005, 1004, 1003, 1002, 1001]);
    expect(second.olderBefore).toBeNull();
  });

  it("counts items and carries the attention flag", async () => {
    const { order } = await seedPendingOrder({ quantity: 3 });
    await testDb.order.update({
      where: { id: order.id },
      data: { status: "paid", needsAttention: true },
    });

    const [row] = (await getAdminOrders({ all: false, before: null })).rows;

    expect(row).toMatchObject({
      number: 1001,
      itemCount: 3,
      needsAttention: true,
      totalCents: 7500,
    });
  });

  it("counts items as the sum of every line's quantity, not the number of lines", async () => {
    const { order } = await seedPendingOrder({ quantity: 2 });
    await testDb.orderLine.create({
      data: {
        orderId: order.id,
        productName: "Socks",
        sku: "SKU-SOCKS",
        unitPriceCents: 900,
        quantity: 3,
        lineTotalCents: 2700,
      },
    });
    await testDb.order.update({ where: { id: order.id }, data: { status: "paid" } });

    const [row] = (await getAdminOrders({ all: false, before: null })).rows;

    expect(row?.itemCount).toBe(5);
  });
});

describe("getAdminOrders on purged orders (spec 0008)", () => {
  it("lists a purged order beside the others, with no email and its purge time (AC-8)", async () => {
    await createOrder({ status: "paid", email: "kept@example.com" });
    const purged = await purgedOrder();

    const { rows } = await getAdminOrders({ all: true, before: null });

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === purged.id)).toMatchObject({
      email: null,
      piiPurgedAt: new Date("2026-09-01T04:00:00Z"),
      shipTo: null,
    });
    expect(rows.find((row) => row.id !== purged.id)).toMatchObject({
      email: "kept@example.com",
      piiPurgedAt: null,
    });
  });

  // A purged order has no email by design, so it must never raise the missing email alarm.
  it("does not log a purged order as missing its email (AC-9)", async () => {
    await purgedOrder();

    await getAdminOrders({ all: true, before: null });

    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("keeps a purged order out of the default view, which shows paid and later only", async () => {
    await purgedOrder();

    expect((await getAdminOrders({ all: false, before: null })).rows).toEqual([]);
  });
});

describe("parseAdminOrdersParams", () => {
  it("reads the view and the page, ignoring anything malformed", () => {
    expect(parseAdminOrdersParams({ view: "all", before: "1050" })).toEqual({
      all: true,
      before: 1050,
    });
    expect(parseAdminOrdersParams({ view: "weird", before: "abc" })).toEqual({
      all: false,
      before: null,
    });
    expect(parseAdminOrdersParams({})).toEqual({ all: false, before: null });
  });
});

describe("getAdminOrder", () => {
  it("returns the snapshot lines, events and Stripe dashboard links", async () => {
    const { order } = await seedPendingOrder({ sessionId: "cs_test_1" });
    await testDb.order.update({
      where: { id: order.id },
      data: { status: "paid", paidAt: new Date(), stripePaymentIntentId: "pi_test_1" },
    });

    const detail = await getAdminOrder("1001");

    expect(detail).toMatchObject({
      number: 1001,
      status: "paid",
      stripe: {
        sessionId: "cs_test_1",
        sessionUrl: "https://dashboard.stripe.com/test/checkout/sessions/cs_test_1",
        paymentIntentId: "pi_test_1",
        paymentUrl: "https://dashboard.stripe.com/test/payments/pi_test_1",
      },
    });
    expect(detail?.lines).toHaveLength(1);
    expect(detail?.events.map((event) => event.type)).toEqual(["created"]);
  });

  it("shows the name and SKU the customer bought, even after the catalog changes", async () => {
    const { product, variant } = await seedPendingOrder();
    const bought = { productName: product.name, sku: variant.sku };
    await testDb.product.update({ where: { id: product.id }, data: { name: "Renamed" } });
    await testDb.productVariant.update({ where: { id: variant.id }, data: { sku: "SKU-NEW" } });

    const detail = await getAdminOrder("1001");

    expect(detail?.lines).toEqual([expect.objectContaining(bought)]);
  });

  it("returns a purged order with no email, no address and its purge time (spec 0008, AC-8)", async () => {
    const purged = await purgedOrder();

    const detail = await getAdminOrder(String(purged.number));

    expect(detail).toMatchObject({
      number: purged.number,
      status: "expired",
      email: null,
      piiPurgedAt: new Date("2026-09-01T04:00:00Z"),
    });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(["9999", "abc", "1000", "-1", undefined])("is null for %j", async (value) => {
    await createOrder();

    expect(await getAdminOrder(value)).toBeNull();
  });
});
