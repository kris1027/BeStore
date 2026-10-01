import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectViolation, resetDatabaseBeforeEach, SQLSTATE, testDb } from "./client";
import { createCustomer, createOrder } from "./fixtures";

// spec 0008: the daily purge of personal data from orders expired more than 30 days ago.

const secret = "s".repeat(32);

const mocks = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: mocks.error },
}));

const {
  EXPIRED_ORDER_PII_RETENTION_DAYS,
  purgeBatch,
  purgeExpiredOrders,
  purgeExpiredOrdersRequest,
} = await import("@/features/orders/purge-expired");

resetDatabaseBeforeEach();

beforeEach(() => vi.clearAllMocks());

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/purge-expired-orders", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

const authorized = () => request(`Bearer ${secret}`);

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

// An order with every personal data column filled, a line, a session and a cart and customer link.
async function seedOrder(
  status: "pending_payment" | "paid" | "shipped" | "delivered" | "cancelled" | "expired",
  { expiredAt, needsAttention = false }: { expiredAt?: Date; needsAttention?: boolean } = {},
) {
  const customer = await createCustomer(`${crypto.randomUUID()}@example.com`);
  const cart = await testDb.cart.create({ data: { expiresAt: daysAgo(-30) } });
  const order = await createOrder({
    status,
    expiredAt,
    email: "ada@example.com",
    customerId: customer.id,
    cartId: cart.id,
  });
  await testDb.orderLine.create({
    data: {
      orderId: order.id,
      productName: "Mug",
      sku: "SKU-MUG",
      unitPriceCents: 2500,
      quantity: 2,
      lineTotalCents: 5000,
    },
  });
  await testDb.orderEvent.create({
    data: { orderId: order.id, type: "note", actorType: "system", message: "seeded" },
  });
  return testDb.order.update({
    where: { id: order.id },
    data: {
      needsAttention,
      customerName: "Ada Lovelace",
      phone: "+33 6 12 34 56 78",
      shipFullName: "Ada Lovelace",
      shipLine1: "1 Rue de la Paix",
      shipLine2: "Apt 4",
      shipCity: "Paris",
      shipPostalCode: "75002",
      shipCountryCode: "FR",
      stripeCheckoutSessionId: `cs_test_${order.number}`,
      stripePaymentIntentId: `pi_test_${order.number}`,
    },
  });
}

const due = () =>
  seedOrder("expired", { expiredAt: daysAgo(EXPIRED_ORDER_PII_RETENTION_DAYS + 1) });

async function seedDue(count: number) {
  for (let i = 0; i < count; i += 1) await due();
}

const personalData = {
  email: null,
  customerName: null,
  phone: null,
  shipFullName: null,
  shipLine1: null,
  shipLine2: null,
  shipCity: null,
  shipPostalCode: null,
  shipCountryCode: null,
  cartId: null,
  customerId: null,
};

// AC-1: what a purge must leave exactly as it was.
const keptFields = [
  "number",
  "status",
  "currency",
  "subtotalCents",
  "discountCents",
  "shippingCents",
  "totalCents",
  "stripeCheckoutSessionId",
  "stripePaymentIntentId",
  "needsAttention",
  "expiredAt",
  "lines",
  "events",
] as const;

const reload = (id: string) =>
  testDb.order.findUniqueOrThrow({ where: { id }, include: { lines: true, events: true } });

const purgedCount = () => testDb.order.count({ where: { piiPurgedAt: { not: null } } });

describe("GET /api/cron/purge-expired-orders", () => {
  it.each([
    ["no header", undefined],
    ["a wrong secret", `Bearer ${"x".repeat(32)}`],
    ["the secret without Bearer", secret],
  ])("answers %s with 401 and purges nothing (AC-4)", async (_, header) => {
    await due();

    const response = await purgeExpiredOrdersRequest(request(header));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await purgedCount()).toBe(0);
  });

  it("purges only orders expired more than 30 days ago, keeping everything else (AC-1, AC-2)", async () => {
    const old = await due();
    const recent = await seedOrder("expired", {
      expiredAt: daysAgo(EXPIRED_ORDER_PII_RETENTION_DAYS - 1),
    });
    const others = await Promise.all(
      (["pending_payment", "paid", "shipped", "delivered", "cancelled"] as const).map((status) =>
        seedOrder(status),
      ),
    );
    const before = await reload(old.id);

    const response = await purgeExpiredOrdersRequest(authorized());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ purged: 1 });

    const after = await reload(old.id);
    expect(after).toMatchObject(personalData);
    expect(after.piiPurgedAt).toBeInstanceOf(Date);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    const kept = (order: typeof before) =>
      Object.fromEntries(keptFields.map((field) => [field, order[field]]));
    expect(kept(after)).toEqual(kept(before));

    for (const order of [recent, ...others]) {
      expect(await reload(order.id)).toMatchObject({
        email: "ada@example.com",
        shipLine1: "1 Rue de la Paix",
        cartId: order.cartId,
        piiPurgedAt: null,
      });
    }
  });

  // The due rule reads the database clock, so the expiry is stamped by it too, a minute either
  // side of the cutoff (exactly 30 days drifts past it between the two statements).
  it("purges at 30 days and a minute by the database clock, not at a minute short of 30 days (AC-1)", async () => {
    const [justDue, notYet] = await Promise.all([due(), due()]);
    const stamp = (id: string, offset: string) =>
      testDb.$executeRaw`
        UPDATE orders
        SET expired_at = now() - make_interval(days => ${EXPIRED_ORDER_PII_RETENTION_DAYS}::int)
          + ${offset}::interval
        WHERE id = ${id}::uuid`;
    await stamp(justDue.id, "-1 minute");
    await stamp(notYet.id, "1 minute");

    const response = await purgeExpiredOrdersRequest(authorized());

    expect(await response.json()).toEqual({ purged: 1 });
    expect((await reload(justDue.id)).piiPurgedAt).toBeInstanceOf(Date);
    expect(await reload(notYet.id)).toMatchObject({
      email: "ada@example.com",
      piiPurgedAt: null,
    });
  });

  it("leaves an order purged by an earlier run exactly as that run left it (AC-5)", async () => {
    const order = await due();
    await purgeExpiredOrdersRequest(authorized());
    const first = await reload(order.id);

    const response = await purgeExpiredOrdersRequest(authorized());

    expect(await response.json()).toEqual({ purged: 0 });
    const second = await reload(order.id);
    expect(second.piiPurgedAt).toEqual(first.piiPurgedAt);
    expect(second.updatedAt).toEqual(first.updatedAt);
  });

  it("purges a flagged expired order and keeps the flag (AC-2)", async () => {
    const flagged = await seedOrder("expired", {
      expiredAt: daysAgo(EXPIRED_ORDER_PII_RETENTION_DAYS + 1),
      needsAttention: true,
    });

    await purgeExpiredOrdersRequest(authorized());

    expect(await reload(flagged.id)).toMatchObject({ ...personalData, needsAttention: true });
  });

  it("logs the count only, never personal data (AC-7)", async () => {
    await seedDue(2);

    await purgeExpiredOrdersRequest(authorized());

    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { event: "cron.purge_expired_orders", purged: 2 },
      "cron.purge_expired_orders",
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });
});

describe("the purge loop", () => {
  it("purges every due order in batches, and a second run purges nothing (AC-4, AC-5)", async () => {
    await seedDue(5);
    const runBatch = vi.fn(purgeBatch);

    expect(await purgeExpiredOrders({ batch: 2, runBatch })).toEqual({ purged: 5, error: null });
    // 2 + 2 + 1, then an empty batch ends the run.
    expect(runBatch).toHaveBeenCalledTimes(4);
    expect(await purgeExpiredOrders()).toEqual({ purged: 0, error: null });
  });

  it("stops on the time budget and leaves the rest for the next run (AC-4)", async () => {
    await seedDue(3);

    expect(await purgeExpiredOrders({ batch: 2, budgetMs: 0 })).toEqual({
      purged: 2,
      error: null,
    });
    expect(await purgedCount()).toBe(2);
  });

  it("purges each due order exactly once when two runs overlap (AC-5)", async () => {
    await seedDue(6);

    const results = await Promise.all([
      purgeExpiredOrders({ batch: 2 }),
      purgeExpiredOrders({ batch: 2 }),
    ]);

    expect(results.map((result) => result.error)).toEqual([null, null]);
    expect(results.reduce((sum, result) => sum + result.purged, 0)).toBe(6);
    expect(await purgedCount()).toBe(6);
  });

  it("keeps committed batches when a later batch fails, and answers 500 (AC-6)", async () => {
    await seedDue(4);
    let calls = 0;
    const runBatch = async (batch: number) => {
      calls += 1;
      if (calls === 1) return purgeBatch(batch);
      // A real Postgres error (division_by_zero), so the SQLSTATE travels as in production.
      return testDb.$executeRaw`SELECT 1 / 0`;
    };

    const response = await purgeExpiredOrdersRequest(authorized(), { batch: 2, runBatch });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "purge_failed", purged: 2 });
    expect(await purgedCount()).toBe(2);
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      {
        event: "cron.purge_expired_orders_failed",
        purged: 2,
        errorName: expect.any(String),
        pgCode: "22012",
      },
      "cron.purge_expired_orders_failed",
    );
    expect(mocks.info).not.toHaveBeenCalled();
    // The next run finishes the job.
    expect(await purgeExpiredOrders()).toEqual({ purged: 2, error: null });
  });
});

describe("database guards (AC-3)", () => {
  it("refuses to purge an order that is not expired", async () => {
    const paid = await seedOrder("paid");

    await expectViolation(
      testDb.$executeRaw`UPDATE orders SET pii_purged_at = now() WHERE id = ${paid.id}::uuid`,
      SQLSTATE.check,
      "orders_purge_only_expired_check",
    );
  });

  it("refuses a null email on an order that was not purged", async () => {
    const pending = await seedOrder("pending_payment");

    await expectViolation(
      testDb.$executeRaw`UPDATE orders SET email = NULL WHERE id = ${pending.id}::uuid`,
      SQLSTATE.check,
      "orders_email_present_check",
    );
  });

  it("refuses an expired order without an expiry time", async () => {
    const pending = await seedOrder("pending_payment");

    await expectViolation(
      testDb.$executeRaw`UPDATE orders SET status = 'expired' WHERE id = ${pending.id}::uuid`,
      SQLSTATE.check,
      "orders_expired_at_present_check",
    );
  });
});
