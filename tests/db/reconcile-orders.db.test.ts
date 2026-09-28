import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { autoPaging, eventsOf, seedPendingOrder, sessionEvent, stock } from "./stripe-support";

// GET /api/cron/reconcile-orders against a real Postgres; Stripe's API is stubbed
// (spec 0006, AC-15).

const secret = "s".repeat(32);

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  list: vi.fn(),
  revalidateTag: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: mocks.retrieve } }, events: { list: mocks.list } },
}));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: mocks.error },
}));

const { reconcileOrders, reconcileOrdersRequest } = await import("@/features/orders/reconcile");
const { handleStripeEvent } = await import("@/features/orders/stripe-events");

resetDatabaseBeforeEach();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReturnValue(autoPaging([]));
});

const twoHoursAgo = () => new Date(Date.now() - 2 * 60 * 60 * 1000);

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/reconcile-orders", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

async function run() {
  const response = await reconcileOrdersRequest(request(`Bearer ${secret}`));
  return { status: response.status, body: await response.json() };
}

describe("GET /api/cron/reconcile-orders", () => {
  it.each([
    ["no header", undefined],
    ["a wrong secret", `Bearer ${"x".repeat(32)}`],
  ])("answers %s with 401 and touches nothing", async (_, header) => {
    await seedPendingOrder({ sessionId: null, createdAt: twoHoursAgo() });

    const response = await reconcileOrdersRequest(request(header));

    expect(response.status).toBe(401);
    expect(await testDb.order.count({ where: { status: "pending_payment" } })).toBe(1);
  });

  it("replays a lost paid event so the order ends paid exactly once, however often it runs", async () => {
    const { order, variant } = await seedPendingOrder({
      stock: 5,
      quantity: 2,
      sessionId: "cs_test_lost",
      createdAt: twoHoursAgo(),
    });
    mocks.retrieve.mockResolvedValue({
      id: "cs_test_lost",
      status: "complete",
      payment_status: "paid",
    });
    const paid = sessionEvent("checkout.session.completed", {
      orderId: order.id,
      sessionId: "cs_test_lost",
    });
    const other = sessionEvent("checkout.session.completed", { sessionId: "cs_test_other" });
    mocks.list.mockReturnValue(autoPaging([other, paid]));

    const first = await run();
    const second = await run();

    expect(first.body).toEqual({ checked: 1, paid: 1, expired: 0, skipped: 0, unresolved: 0 });
    expect(second.body).toEqual({ checked: 0, paid: 0, expired: 0, skipped: 0, unresolved: 0 });
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("paid");
    expect(await stock(variant.id)).toBe(3);
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        types: expect.arrayContaining(["checkout.session.completed", "checkout.session.expired"]),
      }),
    );
    expect(mocks.revalidateTag).toHaveBeenCalledWith("catalog", { expire: 0 });
  });

  it("prefers the decisive async event over completed", async () => {
    const { order, variant } = await seedPendingOrder({
      stock: 5,
      quantity: 1,
      sessionId: "cs_test_async",
      createdAt: twoHoursAgo(),
    });
    mocks.retrieve.mockResolvedValue({
      id: "cs_test_async",
      status: "complete",
      payment_status: "paid",
    });
    mocks.list.mockReturnValue(
      autoPaging([
        sessionEvent("checkout.session.completed", {
          orderId: order.id,
          sessionId: "cs_test_async",
          paymentStatus: "unpaid",
        }),
        sessionEvent("checkout.session.async_payment_succeeded", {
          orderId: order.id,
          sessionId: "cs_test_async",
          amountTotal: 2500,
        }),
      ]),
    );

    expect((await run()).body).toMatchObject({ paid: 1 });
    expect(await stock(variant.id)).toBe(4);
  });

  it("expires an old order that never got a session", async () => {
    const { order } = await seedPendingOrder({ sessionId: null, createdAt: twoHoursAgo() });

    expect((await run()).body).toMatchObject({ checked: 1, expired: 1 });
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "expired",
    );
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("replays an expired event", async () => {
    const { order } = await seedPendingOrder({
      sessionId: "cs_test_gone",
      createdAt: twoHoursAgo(),
    });
    mocks.retrieve.mockResolvedValue({
      id: "cs_test_gone",
      status: "expired",
      payment_status: "unpaid",
    });
    mocks.list.mockReturnValue(
      autoPaging([
        sessionEvent("checkout.session.expired", { orderId: order.id, sessionId: "cs_test_gone" }),
      ]),
    );

    expect((await run()).body).toMatchObject({ expired: 1 });
  });

  it.each([
    ["still open", { status: "open", payment_status: "unpaid" }],
    ["complete but processing", { status: "complete", payment_status: "unpaid" }],
  ])("skips a session that is %s", async (_, session) => {
    const { order } = await seedPendingOrder({
      sessionId: "cs_test_live",
      createdAt: twoHoursAgo(),
    });
    mocks.retrieve.mockResolvedValue({ id: "cs_test_live", ...session });

    expect((await run()).body).toMatchObject({ checked: 1, skipped: 1 });
    expect((await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      "pending_payment",
    );
  });

  it("leaves orders younger than 90 minutes alone", async () => {
    await seedPendingOrder({ sessionId: null });

    expect((await run()).body).toMatchObject({ checked: 0 });
  });

  it("draws the line at 90 minutes: 89 is left alone, 91 is reconciled", async () => {
    const nowMs = Date.UTC(2026, 8, 27, 12, 0, 0);
    const minutesAgo = (minutes: number) => new Date(nowMs - minutes * 60 * 1000);
    const { order: fresh } = await seedPendingOrder({
      suffix: "89",
      sessionId: null,
      createdAt: minutesAgo(89),
    });
    const { order: stale } = await seedPendingOrder({
      suffix: "91",
      sessionId: null,
      createdAt: minutesAgo(91),
    });

    const counts = await reconcileOrders(nowMs);

    expect(counts).toMatchObject({ checked: 1, expired: 1 });
    const statusOf = async (id: string) =>
      (await testDb.order.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(fresh.id)).toBe("pending_payment");
    expect(await statusOf(stale.id)).toBe("expired");
  });

  it("flags an order whose session is over but whose event cannot be found, once", async () => {
    const { order } = await seedPendingOrder({
      sessionId: "cs_test_lost",
      createdAt: twoHoursAgo(),
    });
    mocks.retrieve.mockResolvedValue({
      id: "cs_test_lost",
      status: "complete",
      payment_status: "paid",
    });

    const first = await run();
    await run();

    expect(first.body).toMatchObject({ checked: 1, unresolved: 1 });
    const flagged = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(flagged).toMatchObject({ status: "pending_payment", needsAttention: true });
    expect((await eventsOf(order.id)).filter((e) => e.type === "note")).toHaveLength(1);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "cron.reconcile_orders", unresolved: 1 }),
      "cron.reconcile_orders",
    );
  });

  it("does not flag an order the webhook paid while the cron was running", async () => {
    const { order, variant } = await seedPendingOrder({
      stock: 5,
      quantity: 1,
      sessionId: "cs_test_race",
      createdAt: twoHoursAgo(),
    });
    const paid = sessionEvent("checkout.session.completed", {
      orderId: order.id,
      sessionId: "cs_test_race",
      amountTotal: 2500,
    });
    // The webhook lands after the batch was read but before the replay, so the replay is a duplicate.
    mocks.retrieve.mockImplementation(async () => {
      await handleStripeEvent(paid);
      return { id: "cs_test_race", status: "complete", payment_status: "paid" };
    });
    mocks.list.mockReturnValue(autoPaging([paid]));

    expect((await run()).body).toEqual({
      checked: 1,
      paid: 0,
      expired: 0,
      skipped: 1,
      unresolved: 0,
    });
    const settled = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(settled).toMatchObject({ status: "paid", needsAttention: false });
    expect((await eventsOf(order.id)).filter((e) => e.type === "note")).toHaveLength(0);
    expect(await stock(variant.id)).toBe(4);
  });

  it("does not flag an order that was settled when its replayed event turns out stale", async () => {
    const { order } = await seedPendingOrder({
      sessionId: "cs_test_stale",
      createdAt: twoHoursAgo(),
    });
    mocks.retrieve.mockImplementation(async () => {
      await testDb.order.update({ where: { id: order.id }, data: { status: "expired" } });
      return { id: "cs_test_stale", status: "complete", payment_status: "paid" };
    });
    mocks.list.mockReturnValue(
      autoPaging([
        sessionEvent("checkout.session.completed", {
          orderId: order.id,
          sessionId: "cs_test_stale",
        }),
      ]),
    );

    expect((await run()).body).toMatchObject({ checked: 1, skipped: 1, unresolved: 0 });
    const settled = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(settled).toMatchObject({ status: "expired", needsAttention: false });
    expect((await eventsOf(order.id)).filter((e) => e.type === "note")).toHaveLength(0);
  });

  it("skips an order when Stripe cannot be reached and carries on with the rest", async () => {
    await seedPendingOrder({ suffix: "a", sessionId: "cs_test_a", createdAt: twoHoursAgo() });
    await seedPendingOrder({ suffix: "b", sessionId: null, createdAt: twoHoursAgo() });
    mocks.retrieve.mockRejectedValue(new Error("network"));

    expect((await run()).body).toEqual({
      checked: 2,
      paid: 0,
      expired: 1,
      skipped: 1,
      unresolved: 0,
    });
  });

  it("reads flagged orders last, so they never crowd newer stale orders out of the batch", async () => {
    const { order: flagged } = await seedPendingOrder({
      suffix: "a",
      sessionId: "cs_test_flagged",
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });
    await testDb.order.update({ where: { id: flagged.id }, data: { needsAttention: true } });
    const { order: fresh } = await seedPendingOrder({
      suffix: "b",
      sessionId: null,
      createdAt: twoHoursAgo(),
    });

    const counts = await reconcileOrders(Date.now(), 1);

    expect(counts).toEqual({ checked: 1, paid: 0, expired: 1, skipped: 0, unresolved: 0 });
    expect((await testDb.order.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe(
      "expired",
    );
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("skips an order whose database write fails and carries on with the rest", async () => {
    const { order: broken } = await seedPendingOrder({
      suffix: "a",
      sessionId: "cs_test_broken",
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });
    const { order: next } = await seedPendingOrder({
      suffix: "b",
      sessionId: null,
      createdAt: twoHoursAgo(),
    });
    mocks.retrieve.mockResolvedValue({
      id: "cs_test_broken",
      status: "complete",
      payment_status: "paid",
    });
    // The oldest order's flag write fails: it heads every batch, so it must not end the run.
    const transaction = vi
      .spyOn(testDb, "$transaction")
      .mockRejectedValueOnce(new Error("could not serialize access"));

    try {
      expect((await run()).body).toEqual({
        checked: 2,
        paid: 0,
        expired: 1,
        skipped: 1,
        unresolved: 0,
      });
    } finally {
      transaction.mockRestore();
    }
    const statusOf = async (id: string) =>
      (await testDb.order.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(broken.id)).toBe("pending_payment");
    expect(await statusOf(next.id)).toBe("expired");
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "cron.reconcile_order_failed", orderId: broken.id }),
      "cron.reconcile_order_failed",
    );
    expect(mocks.revalidateTag).toHaveBeenCalledWith("catalog", { expire: 0 });
  });
});
