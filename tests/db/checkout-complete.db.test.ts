import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { seedPendingOrder } from "./stripe-support";

// What /checkout/complete shows for each state (spec 0006, AC-11). It only reads.

const mocks = vi.hoisted(() => ({ retrieve: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" } }));
vi.mock("@/lib/stripe", () => ({
  stripe: { checkout: { sessions: { retrieve: mocks.retrieve } } },
}));

const { getCompletion } = await import("@/features/checkout/queries");

resetDatabaseBeforeEach();

beforeEach(() => vi.clearAllMocks());

async function snapshotOfOrders() {
  return testDb.order.findMany({ orderBy: { number: "asc" } });
}

describe("getCompletion", () => {
  it("shows a paid order with its lines and a masked email, without asking Stripe", async () => {
    const { order } = await seedPendingOrder({ sessionId: "cs_test_paid", quantity: 2 });
    await testDb.order.update({ where: { id: order.id }, data: { status: "paid" } });

    const completion = await getCompletion("cs_test_paid");

    expect(completion).toMatchObject({
      state: "paid",
      order: { number: 1001, status: "paid", maskedEmail: "a•••@example.com", totalCents: 5000 },
    });
    expect(completion.state === "paid" && completion.order.lines).toHaveLength(1);
    expect(JSON.stringify(completion)).not.toContain("ada@example.com");
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it.each([
    ["confirming", { status: "complete", payment_status: "paid" }],
    ["processing", { status: "complete", payment_status: "unpaid" }],
    ["not_completed", { status: "open", payment_status: "unpaid" }],
    ["not_completed", { status: "expired", payment_status: "unpaid" }],
  ])(
    "reads a pending order as %s from Stripe's session, and changes nothing",
    async (state, session) => {
      await seedPendingOrder({ sessionId: "cs_test_wait" });
      mocks.retrieve.mockResolvedValueOnce({ id: "cs_test_wait", ...session });
      const before = await snapshotOfOrders();

      const completion = await getCompletion("cs_test_wait");

      expect(completion.state).toBe(state);
      expect(await snapshotOfOrders()).toEqual(before);
    },
  );

  it("keeps confirming when Stripe cannot be reached", async () => {
    await seedPendingOrder({ sessionId: "cs_test_wait" });
    mocks.retrieve.mockRejectedValueOnce(new Error("network"));

    expect(await getCompletion("cs_test_wait")).toEqual({ state: "confirming", number: 1001 });
  });

  it.each([undefined, "", "not-a-session", "cs_test_unknown", ["cs_test_a", "cs_test_b"]])(
    "shows not completed for %j",
    async (sessionId) => {
      expect(await getCompletion(sessionId)).toEqual({ state: "not_completed" });
    },
  );

  it("shows not completed for an expired order", async () => {
    const { order } = await seedPendingOrder({ sessionId: "cs_test_old" });
    await testDb.order.update({ where: { id: order.id }, data: { status: "expired" } });

    expect(await getCompletion("cs_test_old")).toEqual({ state: "not_completed" });
  });
});
