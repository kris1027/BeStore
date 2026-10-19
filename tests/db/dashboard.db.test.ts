import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { paidOrder, refund } from "./dashboard-support";
import { createProduct } from "./fixtures";

// spec 0015: the dashboard's figures against rows placed at known instants. The page's
// requireAdmin() and the admin gate are covered by the e2e tests.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: {
    STRIPE_SECRET_KEY: "sk_test_abc",
    STORE_CURRENCY: "EUR",
    STORE_TIMEZONE: "Europe/Warsaw",
    STORE_LOCALE: "en",
  },
}));
vi.mock("@/lib/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe")>("@/lib/stripe");
  return { stripeDashboardUrl: actual.stripeDashboardUrl };
});
vi.mock("stripe", () => ({ default: class {} }));

const mocks = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: mocks.warn, error: mocks.error },
}));

const { getSalesDashboard } = await import("@/features/dashboard/queries");
const { parseSalesWindow } = await import("@/features/dashboard/period");
const { getAdminOrders, parseAdminOrdersParams } = await import("@/features/orders/admin-queries");

resetDatabaseBeforeEach();
beforeEach(() => vi.clearAllMocks());

// Sunday 18 October 2026 in Warsaw (UTC+2 until 25 October).
const today = { y: 2026, m: 10, d: 18 };
const window = (params: Record<string, string>) => parseSalesWindow(params, today, "Europe/Warsaw");
const at = (iso: string) => new Date(iso);

const zeroTotals = { orders: 0, grossCents: 0, refundCents: 0, netCents: 0, netUnits: 0 };

describe("getSalesDashboard totals", () => {
  it("sums counted orders and refunds of both windows, whatever the status now", async () => {
    // This month (1 to 18 October) and the 18 days before it (13 to 30 September).
    const a = await paidOrder({
      paidAt: at("2026-10-02T10:00:00Z"),
      totalCents: 5000,
      lines: [{ quantity: 2, lineTotalCents: 4000 }, { quantity: 1 }],
    });
    await paidOrder({ paidAt: at("2026-10-10T10:00:00Z"), totalCents: 3001, status: "shipped" });
    await paidOrder({ paidAt: at("2026-10-12T10:00:00Z"), totalCents: 2000, status: "cancelled" });
    await paidOrder({ paidAt: at("2026-09-20T10:00:00Z"), totalCents: 4000, status: "delivered" });
    // Outside both windows.
    await paidOrder({ paidAt: at("2026-09-01T10:00:00Z"), totalCents: 9999 });
    // Never paid.
    await paidOrder({ paidAt: null, totalCents: 7777, status: "pending_payment" });
    await refund({
      orderId: a.id,
      amountCents: 1500,
      succeededAt: at("2026-10-15T10:00:00Z"),
      lines: [{ orderLineId: a.lines[0]?.id ?? "", quantity: 1 }],
    });

    const dashboard = await getSalesDashboard(window({ period: "month" }));

    expect(dashboard.current).toEqual({
      orders: 3,
      grossCents: 10_001,
      refundCents: 1500,
      netCents: 8501,
      netUnits: 3 + 1 + 1 - 1,
    });
    expect(dashboard.previous).toEqual({
      orders: 1,
      grossCents: 4000,
      refundCents: 0,
      netCents: 4000,
      netUnits: 1,
    });
    expect(dashboard.foreignOrders).toBe(0);
  });

  it("takes a refund off the period it succeeded in, never its order's", async () => {
    const order = await paidOrder({ paidAt: at("2026-09-20T10:00:00Z"), totalCents: 4000 });
    await refund({ orderId: order.id, amountCents: 1000, succeededAt: at("2026-10-05T10:00:00Z") });

    const october = await getSalesDashboard(window({ from: "2026-10-01", to: "2026-10-18" }));
    const september = await getSalesDashboard(window({ from: "2026-09-01", to: "2026-09-30" }));

    expect(october.current).toMatchObject({ orders: 0, grossCents: 0, netCents: -1000 });
    expect(september.current).toMatchObject({ orders: 1, grossCents: 4000, netCents: 4000 });
  });

  it("never counts pending or failed refunds, or refunds of orders never marked paid", async () => {
    const paid = await paidOrder({ paidAt: at("2026-10-02T10:00:00Z"), totalCents: 4000 });
    const late = await paidOrder({ paidAt: null, totalCents: 3000, status: "cancelled" });
    await refund({ orderId: paid.id, amountCents: 500, succeededAt: null });
    await refund({ orderId: paid.id, amountCents: 600, succeededAt: null, status: "failed" });
    await refund({ orderId: late.id, amountCents: 3000, succeededAt: at("2026-10-03T10:00:00Z") });

    const dashboard = await getSalesDashboard(window({ period: "month" }));

    expect(dashboard.current).toMatchObject({ grossCents: 4000, refundCents: 0, netCents: 4000 });
  });

  it("leaves other currencies out of every figure and counts them once", async () => {
    await paidOrder({ paidAt: at("2026-10-02T10:00:00Z"), totalCents: 4000 });
    const usd = await paidOrder({
      paidAt: at("2026-10-03T10:00:00Z"),
      totalCents: 9000,
      currency: "USD",
    });
    await refund({ orderId: usd.id, amountCents: 100, succeededAt: at("2026-10-04T10:00:00Z") });
    const olderUsd = await paidOrder({
      paidAt: at("2026-08-03T10:00:00Z"),
      totalCents: 9000,
      currency: "USD",
    });
    await refund({
      orderId: olderUsd.id,
      amountCents: 50,
      succeededAt: at("2026-10-05T10:00:00Z"),
    });

    const dashboard = await getSalesDashboard(window({ period: "month" }));

    expect(dashboard.current).toMatchObject({ orders: 1, grossCents: 4000, refundCents: 0 });
    expect(dashboard.foreignOrders).toBe(2);
    expect(dashboard.bestSellers.map((row) => row.salesCents)).toEqual([4000]);
  });

  it("shows zeros for an empty period", async () => {
    const dashboard = await getSalesDashboard(window({ period: "today" }));

    expect(dashboard.current).toEqual(zeroTotals);
    expect(dashboard.previous).toEqual(zeroTotals);
    expect(dashboard.buckets).toEqual([
      { key: "2026-10-18", firstDay: "2026-10-18", grossCents: 0, refundCents: 0, netCents: 0 },
    ]);
    expect(dashboard.bestSellers).toEqual([]);
    expect(dashboard.hiddenGroups).toBe(0);
  });
});

describe("getSalesDashboard buckets", () => {
  it("puts 23:59 and 00:00 store time on different days, across a clock change", async () => {
    // 25 October 2026: Warsaw goes from UTC+2 to UTC+1 at 03:00.
    await paidOrder({ paidAt: at("2026-10-24T21:59:59Z"), totalCents: 100 }); // 23:59:59 on the 24th
    await paidOrder({ paidAt: at("2026-10-24T22:00:00Z"), totalCents: 200 }); // 00:00 on the 25th
    await paidOrder({ paidAt: at("2026-10-25T22:59:59Z"), totalCents: 400 }); // 23:59:59 on the 25th
    await paidOrder({ paidAt: at("2026-10-25T23:00:00Z"), totalCents: 800 }); // 00:00 on the 26th

    const dashboard = await getSalesDashboard(
      parseSalesWindow(
        { from: "2026-10-24", to: "2026-10-26" },
        { y: 2026, m: 11, d: 1 },
        "Europe/Warsaw",
      ),
    );

    expect(dashboard.buckets.map((bucket) => [bucket.key, bucket.grossCents])).toEqual([
      ["2026-10-24", 100],
      ["2026-10-25", 600],
      ["2026-10-26", 800],
    ]);
  });

  it.each([
    ["days", { period: "30d" }, "day"],
    ["clipped weeks", { from: "2026-07-16", to: "2026-10-18" }, "week"],
    ["clipped months", { from: "2026-03-15", to: "2026-10-18" }, "month"],
  ])("adds up to the window's figures by %s", async (_, params, unit) => {
    const instants = [
      "2026-03-15T08:00:00Z",
      "2026-05-31T21:30:00Z",
      "2026-07-16T00:30:00Z",
      "2026-08-02T12:00:00Z",
      "2026-09-19T12:00:00Z",
      "2026-10-12T05:00:00Z",
      "2026-10-18T21:59:00Z",
    ];
    for (const [index, instant] of instants.entries()) {
      const order = await paidOrder({ paidAt: at(instant), totalCents: 1000 * (index + 1) });
      await refund({ orderId: order.id, amountCents: 100 * (index + 1), succeededAt: at(instant) });
    }
    const salesWindow = window(params);
    const dashboard = await getSalesDashboard(salesWindow);

    expect(salesWindow.unit).toBe(unit);
    expect(dashboard.buckets).toHaveLength(salesWindow.buckets.length);
    const sum = (pick: (bucket: (typeof dashboard.buckets)[number]) => number) =>
      dashboard.buckets.reduce((total, bucket) => total + pick(bucket), 0);
    expect(sum((bucket) => bucket.grossCents)).toBe(dashboard.current.grossCents);
    expect(sum((bucket) => bucket.refundCents)).toBe(dashboard.current.refundCents);
    expect(sum((bucket) => bucket.netCents)).toBe(dashboard.current.netCents);
    expect(dashboard.current.grossCents).toBeGreaterThan(0);
  });

  it("shows a negative bucket when refunds beat sales that day", async () => {
    const order = await paidOrder({ paidAt: at("2026-09-01T10:00:00Z"), totalCents: 5000 });
    await refund({ orderId: order.id, amountCents: 5000, succeededAt: at("2026-10-17T10:00:00Z") });

    const dashboard = await getSalesDashboard(window({ period: "7d" }));

    expect(dashboard.buckets.find((bucket) => bucket.key === "2026-10-17")?.netCents).toBe(-5000);
  });
});

describe("getSalesDashboard best sellers", () => {
  it("ranks by net units, then sales, then name, using the current product name", async () => {
    const mug = await createProduct("mug");
    const cap = await createProduct("cap");
    const tote = await createProduct("tote");
    await testDb.product.update({ where: { id: mug.id }, data: { name: "Mug (new name)" } });
    const day = at("2026-10-05T10:00:00Z");
    await paidOrder({
      paidAt: day,
      totalCents: 9000,
      lines: [
        { productId: mug.id, productName: "Mug", quantity: 3, lineTotalCents: 3000 },
        { productId: cap.id, productName: "Cap", quantity: 2, lineTotalCents: 4000 },
        { productId: tote.id, productName: "Tote", quantity: 2, lineTotalCents: 2000 },
      ],
    });

    const dashboard = await getSalesDashboard(window({ period: "month" }));

    expect(dashboard.bestSellers).toEqual([
      { productId: mug.id, name: "Mug (new name)", netUnits: 3, salesCents: 3000 },
      { productId: cap.id, name: cap.name, netUnits: 2, salesCents: 4000 },
      { productId: tote.id, name: tote.name, netUnits: 2, salesCents: 2000 },
    ]);
    expect(dashboard.hiddenGroups).toBe(0);
  });

  it("groups a deleted product by its latest line name, with no link", async () => {
    await paidOrder({
      paidAt: at("2026-10-03T10:00:00Z"),
      lines: [{ productName: "Old Mug", quantity: 2, lineTotalCents: 1000 }],
    });
    await paidOrder({
      paidAt: at("2026-10-04T10:00:00Z"),
      lines: [{ productName: "Old Mug", quantity: 1, lineTotalCents: 500 }],
    });

    const dashboard = await getSalesDashboard(window({ period: "month" }));

    expect(dashboard.bestSellers).toEqual([
      { productId: null, name: "Old Mug", netUnits: 3, salesCents: 1500 },
    ]);
  });

  it("takes refunded units off, hides groups at 0 or below and counts them", async () => {
    const shirt = await createProduct("shirt");
    const hat = await createProduct("hat");
    const sock = await createProduct("sock");
    // Sold before the window, refunded in it: only refunded here, so -1 net units.
    const earlier = await paidOrder({
      paidAt: at("2026-09-02T10:00:00Z"),
      lines: [{ productId: sock.id, quantity: 1 }],
    });
    const order = await paidOrder({
      paidAt: at("2026-10-03T10:00:00Z"),
      totalCents: 6000,
      lines: [
        { productId: shirt.id, quantity: 3, lineTotalCents: 3000 },
        { productId: hat.id, quantity: 1, lineTotalCents: 3000 },
      ],
    });
    const [shirtLine, hatLine] = order.lines;
    await refund({
      orderId: order.id,
      amountCents: 4000,
      succeededAt: at("2026-10-04T10:00:00Z"),
      lines: [
        { orderLineId: shirtLine?.id ?? "", quantity: 1 },
        { orderLineId: hatLine?.id ?? "", quantity: 1 },
      ],
    });
    await refund({
      orderId: earlier.id,
      amountCents: 1000,
      succeededAt: at("2026-10-04T10:00:00Z"),
      lines: [{ orderLineId: earlier.lines[0]?.id ?? "", quantity: 1 }],
    });

    const dashboard = await getSalesDashboard(window({ period: "month" }));

    expect(dashboard.bestSellers).toEqual([
      { productId: shirt.id, name: shirt.name, netUnits: 2, salesCents: 3000 },
    ]);
    expect(dashboard.hiddenGroups).toBe(2);
    expect(dashboard.current.netUnits).toBe(4 - 2 - 1);
  });

  it("still counts hidden groups when none is listed", async () => {
    const sock = await createProduct("sock");
    const order = await paidOrder({
      paidAt: at("2026-09-02T10:00:00Z"),
      lines: [{ productId: sock.id, quantity: 1 }],
    });
    await refund({
      orderId: order.id,
      amountCents: 1000,
      succeededAt: at("2026-10-04T10:00:00Z"),
      lines: [{ orderLineId: order.lines[0]?.id ?? "", quantity: 1 }],
    });

    const dashboard = await getSalesDashboard(window({ period: "month" }));

    expect(dashboard.bestSellers).toEqual([]);
    expect(dashboard.hiddenGroups).toBe(1);
  });

  it("lists the top 10 only", async () => {
    const lines = [];
    for (let index = 1; index <= 12; index += 1) {
      const product = await createProduct(`p${index}`);
      lines.push({ productId: product.id, quantity: index, lineTotalCents: 100 });
    }
    await paidOrder({ paidAt: at("2026-10-03T10:00:00Z"), totalCents: 1200, lines });

    const dashboard = await getSalesDashboard(window({ period: "month" }));

    expect(dashboard.bestSellers.map((row) => row.netUnits)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
  });
});

describe("the orders link", () => {
  // spec 0015, AC-13: every order in the window is in the store's currency here.
  it("lists exactly the orders the Orders card counts", async () => {
    await paidOrder({ paidAt: at("2026-09-30T21:59:00Z") }); // 23:59 on 30 September
    await paidOrder({ paidAt: at("2026-09-30T22:00:00Z") }); // 00:00 on 1 October
    await paidOrder({ paidAt: at("2026-10-12T10:00:00Z"), status: "cancelled" });
    await paidOrder({ paidAt: at("2026-10-18T21:59:00Z"), status: "delivered" });
    await paidOrder({ paidAt: null, status: "pending_payment" });

    const salesWindow = window({ period: "month" });
    const dashboard = await getSalesDashboard(salesWindow);
    const list = await getAdminOrders(
      parseAdminOrdersParams({
        status: "all",
        dates: "paid",
        from: salesWindow.current.firstDay,
        to: salesWindow.current.lastDay,
      }),
    );

    expect(dashboard.current.orders).toBe(3);
    expect(list.rows).toHaveLength(3);
  });
});

describe("failures", () => {
  it("logs the SQLSTATE, never the message, and rethrows", async () => {
    const failure = Object.assign(new Error("canceling statement due to timeout"), {
      meta: { driverAdapterError: { cause: { originalCode: "57014", originalMessage: "row" } } },
    });
    const spy = vi.spyOn(testDb, "$transaction").mockRejectedValueOnce(failure);

    await expect(getSalesDashboard(window({ period: "7d" }))).rejects.toBe(failure);

    expect(mocks.error).toHaveBeenCalledWith(
      { event: "dashboard.query_failed", period: "7d", days: 7, code: "57014" },
      "dashboard.query_failed",
    );
    spy.mockRestore();
  });
});
