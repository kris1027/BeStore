import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";

// spec 0015, AC-15: a seeded year of orders and refunds. Every figure for Last 12 months equals
// what this test sums on its own from the rows it wrote, and the reads stay within the CI budget.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: { STORE_CURRENCY: "EUR", STORE_TIMEZONE: "Europe/Warsaw", STORE_LOCALE: "en" },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getSalesDashboard } = await import("@/features/dashboard/queries");
const { parseSalesWindow } = await import("@/features/dashboard/period");

resetDatabaseBeforeEach();

const CI_BUDGET_MS = 1_500;
const LOCAL_TARGET_MS = 500;
const COUNTED_ORDERS = 20_000;
const PREVIOUS_ORDERS = 4_000;
const SUCCEEDED_REFUNDS = 2_000;
const ZONE = "Europe/Warsaw";

// A small seeded PRNG (mulberry32), so every run writes the same rows.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// The store month an instant falls in, worked out apart from the SQL under test.
const monthParts = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
});
function storeMonth(instant: Date): string {
  const parts = monthParts.formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-01`;
}

type SeedLine = {
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
  lineTotalCents: number;
  createdAt: Date;
};

async function inChunks<T>(
  rows: readonly T[],
  size: number,
  write: (chunk: T[]) => Promise<unknown>,
) {
  for (let index = 0; index < rows.length; index += size) {
    await write(rows.slice(index, index + size));
  }
}

describe("a year of orders", () => {
  it("gives exact figures for Last 12 months, within the time budget", async () => {
    const next = random(15);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
    const salesWindow = parseSalesWindow({ period: "12m" }, { y: 2026, m: 10, d: 18 }, ZONE);
    const { current, previous } = salesWindow;
    const between = (start: Date, end: Date) =>
      new Date(start.getTime() + Math.floor(next() * (end.getTime() - start.getTime())));

    const products = Array.from({ length: 30 }, (_, index) => ({
      id: randomUUID(),
      name: `Product ${String(index).padStart(2, "0")}`,
      slug: `product-${index}`,
      status: "active" as const,
    }));
    // Lines whose product was deleted: grouped by their name snapshot.
    const deletedNames = ["Old Mug", "Old Cap", "Old Tote"];

    const orders: {
      id: string;
      status: "paid" | "shipped" | "delivered" | "cancelled";
      email: string;
      currency: string;
      subtotalCents: number;
      discountCents: number;
      shippingCents: number;
      totalCents: number;
      paidAt: Date | null;
    }[] = [];
    const lines: SeedLine[] = [];

    function addOrder(paidAt: Date | null, currency = "EUR") {
      const id = randomUUID();
      const lineCount = 1 + Math.floor(next() * 3);
      let total = 0;
      for (let index = 0; index < lineCount; index += 1) {
        const deleted = next() < 0.05;
        const product = pick(products);
        const quantity = 1 + Math.floor(next() * 4);
        const unitPriceCents = 500 + Math.floor(next() * 9500);
        const discountCents = next() < 0.2 ? Math.floor(unitPriceCents * quantity * 0.1) : 0;
        const lineTotalCents = unitPriceCents * quantity - discountCents;
        total += lineTotalCents;
        lines.push({
          id: randomUUID(),
          orderId: id,
          productId: deleted ? null : product.id,
          productName: deleted ? pick(deletedNames) : product.name,
          sku: `SKU-${lines.length}`,
          unitPriceCents,
          quantity,
          discountCents,
          lineTotalCents,
          createdAt: paidAt ?? new Date("2026-01-01T00:00:00Z"),
        });
      }
      // A promo code now and then, so gross is the order total, not the sum of its lines.
      const discount = next() < 0.1 ? Math.floor(total * 0.15) : 0;
      const shipping = next() < 0.5 ? 499 : 0;
      orders.push({
        id,
        status: paidAt === null ? "cancelled" : pick(["paid", "shipped", "delivered", "cancelled"]),
        email: `buyer${orders.length}@example.com`,
        currency,
        subtotalCents: total,
        discountCents: discount,
        shippingCents: shipping,
        totalCents: total - discount + shipping,
        paidAt,
      });
      return id;
    }

    for (let index = 0; index < COUNTED_ORDERS; index += 1) {
      addOrder(between(current.start, current.end));
    }
    // The window's edges: the first and last millisecond in, the ones beside them out.
    addOrder(current.start);
    addOrder(new Date(current.start.getTime() - 1));
    addOrder(new Date(current.end.getTime() - 1));
    addOrder(current.end);
    for (let index = 0; index < PREVIOUS_ORDERS; index += 1) {
      addOrder(between(previous.start, previous.end));
    }
    // Noise that must count nowhere but the currency notice, or nowhere at all.
    for (let index = 0; index < 300; index += 1)
      addOrder(between(current.start, current.end), "USD");
    for (let index = 0; index < 200; index += 1) addOrder(null);

    // Refunds: succeeded in either window, of any order (paid long before included), some with
    // lines; plus pending and failed ones that never count.
    const refunds: {
      id: string;
      orderId: string;
      amountCents: number;
      status: "succeeded" | "pending" | "failed";
      succeededAt: Date | null;
      actorType: "system";
    }[] = [];
    const refundLines: { refundId: string; orderLineId: string; quantity: number }[] = [];
    const linesByOrder = new Map<string, SeedLine[]>();
    for (const line of lines) {
      linesByOrder.set(line.orderId, [...(linesByOrder.get(line.orderId) ?? []), line]);
    }
    for (let index = 0; index < SUCCEEDED_REFUNDS + 300; index += 1) {
      const order = pick(orders);
      const id = randomUUID();
      const status = index < SUCCEEDED_REFUNDS ? "succeeded" : pick(["pending", "failed"] as const);
      refunds.push({
        id,
        orderId: order.id,
        amountCents: 1 + Math.floor(next() * order.totalCents),
        status,
        succeededAt: status === "succeeded" ? between(previous.start, current.end) : null,
        actorType: "system",
      });
      if (next() < 0.5) {
        const line = pick(linesByOrder.get(order.id) ?? []);
        refundLines.push({
          refundId: id,
          orderLineId: line.id,
          quantity: 1 + Math.floor(next() * line.quantity),
        });
      }
    }

    await testDb.product.createMany({ data: products });
    await inChunks(orders, 2_000, (chunk) => testDb.order.createMany({ data: chunk }));
    await inChunks(lines, 5_000, (chunk) => testDb.orderLine.createMany({ data: chunk }));
    await inChunks(refunds, 2_000, (chunk) => testDb.refund.createMany({ data: chunk }));
    await inChunks(refundLines, 2_000, (chunk) => testDb.refundLine.createMany({ data: chunk }));
    await testDb.$executeRawUnsafe("ANALYZE orders, order_lines, refunds, refund_lines");

    // What the dashboard must say, summed here from the rows above.
    const orderById = new Map(orders.map((order) => [order.id, order]));
    const lineById = new Map(lines.map((line) => [line.id, line]));
    const inRange = (instant: Date | null, range: { start: Date; end: Date }) =>
      instant !== null && instant >= range.start && instant < range.end;
    const counted = (range: { start: Date; end: Date }) =>
      orders.filter((order) => order.currency === "EUR" && inRange(order.paidAt, range));
    const countedRefunds = (range: { start: Date; end: Date }) =>
      refunds.filter((item) => {
        const order = orderById.get(item.orderId);
        return (
          item.status === "succeeded" &&
          inRange(item.succeededAt, range) &&
          order?.paidAt != null &&
          order.currency === "EUR"
        );
      });
    const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
    function totals(range: { start: Date; end: Date }) {
      const ordersIn = counted(range);
      const ids = new Set(ordersIn.map((order) => order.id));
      const refundsIn = countedRefunds(range);
      const refundIds = new Set(refundsIn.map((item) => item.id));
      const grossCents = sum(ordersIn.map((order) => order.totalCents));
      const refundCents = sum(refundsIn.map((item) => item.amountCents));
      return {
        orders: ordersIn.length,
        grossCents,
        refundCents,
        netCents: grossCents - refundCents,
        netUnits:
          sum(lines.filter((line) => ids.has(line.orderId)).map((line) => line.quantity)) -
          sum(refundLines.filter((rl) => refundIds.has(rl.refundId)).map((rl) => rl.quantity)),
      };
    }
    const expectedCurrent = totals(current);

    const grossByMonth = new Map<string, number>();
    for (const order of counted(current)) {
      const key = storeMonth(order.paidAt as Date);
      grossByMonth.set(key, (grossByMonth.get(key) ?? 0) + order.totalCents);
    }
    const refundsByMonth = new Map<string, number>();
    for (const item of countedRefunds(current)) {
      const key = storeMonth(item.succeededAt as Date);
      refundsByMonth.set(key, (refundsByMonth.get(key) ?? 0) + item.amountCents);
    }

    type Group = { productId: string | null; name: string; net: number; sales: number };
    const groups = new Map<string, Group>();
    const groupOf = (line: SeedLine): Group => {
      const key = line.productId ?? `name:${line.productName}`;
      const existing = groups.get(key);
      if (existing) return existing;
      const created = { productId: line.productId, name: line.productName, net: 0, sales: 0 };
      groups.set(key, created);
      return created;
    };
    const currentIds = new Set(counted(current).map((order) => order.id));
    for (const line of lines.filter((item) => currentIds.has(item.orderId))) {
      const group = groupOf(line);
      group.net += line.quantity;
      group.sales += line.lineTotalCents;
    }
    const currentRefundIds = new Set(countedRefunds(current).map((item) => item.id));
    for (const rl of refundLines.filter((item) => currentRefundIds.has(item.refundId))) {
      groupOf(lineById.get(rl.orderLineId) as SeedLine).net -= rl.quantity;
    }
    const ranked = [...groups.values()].sort(
      (a, b) => b.net - a.net || b.sales - a.sales || a.name.localeCompare(b.name),
    );
    const expectedBest = ranked
      .filter((group) => group.net > 0)
      .slice(0, 10)
      .map((group) => ({
        productId: group.productId,
        name: group.name,
        netUnits: group.net,
        salesCents: group.sales,
      }));

    // Warm up once, then time three runs of every dashboard read.
    const dashboard = await getSalesDashboard(salesWindow);
    const durations: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      await getSalesDashboard(salesWindow);
      durations.push(performance.now() - started);
    }
    const median = [...durations].sort((a, b) => a - b)[1] ?? Infinity;
    console.info(
      `dashboard reads, Last 12 months: median ${Math.round(median)} ms ` +
        `(local target ${LOCAL_TARGET_MS} ms, CI budget ${CI_BUDGET_MS} ms)`,
    );

    expect(expectedCurrent.orders).toBeGreaterThanOrEqual(COUNTED_ORDERS);
    expect(dashboard.current).toEqual(expectedCurrent);
    expect(dashboard.previous).toEqual(totals(previous));
    expect(
      dashboard.buckets.map(({ key, grossCents, refundCents }) => [key, grossCents, refundCents]),
    ).toEqual(
      salesWindow.buckets.map(({ key }) => [
        key,
        grossByMonth.get(key) ?? 0,
        refundsByMonth.get(key) ?? 0,
      ]),
    );
    expect(dashboard.bestSellers).toEqual(expectedBest);
    expect(dashboard.hiddenGroups).toBe(ranked.filter((group) => group.net <= 0).length);
    expect(dashboard.foreignOrders).toBe(300);
    expect(median).toBeLessThanOrEqual(CI_BUDGET_MS);
  }, 180_000);
});
