import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createOrder } from "./fixtures";
import { seedPendingOrder } from "./stripe-support";

// The admin order list and detail queries (spec 0006, AC-12 and AC-13). The pages' requireAdmin()
// and the proxy 404 are covered by the e2e denial tests.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: { STRIPE_SECRET_KEY: "sk_test_abc", STORE_TIMEZONE: "Europe/Warsaw", STORE_LOCALE: "en" },
}));
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

// The list as the page parses it from the URL.
const view = (params: Record<string, string> = {}) => parseAdminOrdersParams(params);

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

    const settled = await getAdminOrders(view());
    const all = await getAdminOrders(view({ status: "all" }));

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

    const first = await getAdminOrders(view());
    const second = await getAdminOrders({ ...view(), before: first.olderBefore });

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

    const [row] = (await getAdminOrders(view())).rows;

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

    const [row] = (await getAdminOrders(view())).rows;

    expect(row?.itemCount).toBe(5);
  });
});

describe("getAdminOrders on purged orders (spec 0008)", () => {
  it("lists a purged order beside the others, with no email and its purge time (AC-8)", async () => {
    await createOrder({ status: "paid", email: "kept@example.com" });
    const purged = await purgedOrder();

    const { rows } = await getAdminOrders(view({ status: "all" }));

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

    await getAdminOrders(view({ status: "all" }));

    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("keeps a purged order out of the default view, which shows paid and later only", async () => {
    await purgedOrder();

    expect((await getAdminOrders(view())).rows).toEqual([]);
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

describe("getAdminOrders filters (spec 0010, AC-1 to AC-3)", () => {
  async function order(input: Parameters<typeof createOrder>[0] & { name?: string } = {}) {
    const { name, ...rest } = input;
    const created = await createOrder({ status: "paid", ...rest });
    if (name) {
      await testDb.order.update({ where: { id: created.id }, data: { customerName: name } });
    }
    return created;
  }

  const numbers = async (params: Record<string, string>) =>
    (await getAdminOrders(view(params))).rows.map((row) => row.number);

  it("searches the exact number, and email and names case insensitively as substrings", async () => {
    await order({ email: "ada@example.com" });
    await order({ email: "bob@example.com", name: "Grace HOPPER" });
    const shipped = await order({ email: "cy@example.com" });
    await testDb.order.update({ where: { id: shipped.id }, data: { shipFullName: "Linus" } });

    expect(await numbers({ q: "1002" })).toEqual([1002]);
    expect(await numbers({ q: "ADA@" })).toEqual([1001]);
    expect(await numbers({ q: "hopper" })).toEqual([1002]);
    expect(await numbers({ q: "linu" })).toEqual([1003]);
    expect(await numbers({ q: "99999999999" })).toEqual([]);
  });

  it("matches %, _ and \\ literally", async () => {
    await order({ email: "fifty%off@example.com" });
    await order({ email: "fifty1off@example.com" });
    await order({ email: "a_b@example.com" });
    await order({ email: "axb@example.com" });

    expect(await numbers({ q: "fifty%" })).toEqual([1001]);
    expect(await numbers({ q: "a_b" })).toEqual([1003]);
    expect(await numbers({ q: "\\" })).toEqual([]);
  });

  it("filters by status, attention and refund state, combined", async () => {
    await order({ status: "shipped" });
    const flagged = await order();
    await testDb.order.update({ where: { id: flagged.id }, data: { needsAttention: true } });
    const partial = await order();
    await testDb.order.update({ where: { id: partial.id }, data: { refundedCents: 100 } });
    const full = await order();
    await testDb.order.update({ where: { id: full.id }, data: { refundedCents: full.totalCents } });
    await order({ status: "expired" });

    expect(await numbers({ status: "shipped" })).toEqual([1001]);
    expect(await numbers({ attention: "1" })).toEqual([1002]);
    expect(await numbers({ refund: "partial" })).toEqual([1003]);
    expect(await numbers({ refund: "full" })).toEqual([1004]);
    expect(await numbers({ refund: "none" })).toEqual([1002, 1001]);
    expect(await numbers({ refund: "none", status: "all" })).toEqual([1005, 1002, 1001]);
    expect(await numbers({ status: "paid", attention: "1", refund: "none" })).toEqual([1002]);
  });

  it("takes whole days in the store's time zone, both ends inclusive", async () => {
    const at = async (iso: string) => {
      const created = await order();
      await testDb.order.update({ where: { id: created.id }, data: { createdAt: new Date(iso) } });
    };
    await at("2026-09-30T21:59:00Z"); // 23:59 on 30 Sept in Warsaw
    await at("2026-09-30T22:00:00Z"); // 00:00 on 1 Oct
    await at("2026-10-01T21:59:59Z"); // 23:59 on 1 Oct
    await at("2026-10-01T22:00:00Z"); // 00:00 on 2 Oct

    expect(await numbers({ from: "2026-10-01", to: "2026-10-01" })).toEqual([1003, 1002]);
    expect(await numbers({ to: "2026-09-30" })).toEqual([1001]);
    // A backwards range is ignored.
    expect(await numbers({ from: "2026-10-02", to: "2026-10-01" })).toHaveLength(4);
  });

  it("keeps the filters across pages", async () => {
    for (let i = 0; i < 52; i += 1) await order({ status: i % 2 === 0 ? "paid" : "shipped" });

    const first = await getAdminOrders(view({ status: "paid" }));
    expect(first.olderBefore).toBeNull();
    expect(first.rows).toHaveLength(26);
    const all = await getAdminOrders(view({ status: "all" }));
    const second = await getAdminOrders({ ...view({ status: "all" }), before: all.olderBefore });
    expect(second.rows.map((row) => row.number)).toEqual([1002, 1001]);
  });
});
