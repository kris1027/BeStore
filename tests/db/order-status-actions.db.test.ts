import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createAdmin } from "./fixtures";
import { orderOf, orderRef, seedPaidOrder } from "./order-support";
import { eventsOf, seedPendingOrder } from "./stripe-support";

// The status, tracking, note and flag actions against a real Postgres (spec 0010, AC-4 to AC-8,
// AC-18 to AC-20, AC-22, AC-23).

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: { STORE_LOCALE: "en", STORE_TIMEZONE: "Europe/Warsaw", STRIPE_SECRET_KEY: "sk_test_x" },
}));
vi.mock("@/lib/stripe", () => ({ stripe: {}, stripeDashboardUrl: () => "https://dashboard" }));
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/features/admin-auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/logger", async (importOriginal) =>
  (await import("./logger-mock")).mockLoggerModule(importOriginal, {
    info: mocks.info,
    warn: mocks.warn,
    error: mocks.error,
  }),
);

const { addNote, resolveAttention } = await import("@/features/orders/actions/notes");
const { editTracking, markDelivered, markShipped, undoStatus } =
  await import("@/features/orders/actions/status");
const { getAdminOrder } = await import("@/features/orders/admin-queries");

resetDatabaseBeforeEach();

let adminId = "";

beforeEach(async () => {
  vi.clearAllMocks();
  adminId = (await createAdmin()).id;
  mocks.requireAdmin.mockResolvedValue({ id: adminId, email: "admin@example.com", name: "Admin" });
});

const stale = { ok: false, error: { code: "stale" } };
const moved = { ok: false, error: { code: "invalid_transition" } };

describe("markShipped (AC-4)", () => {
  it("ships a paid order with carrier and tracking, and writes the event", async () => {
    await seedPaidOrder();

    const result = await markShipped({
      ...(await orderRef()),
      carrier: "  DHL ",
      trackingNumber: "JD0123",
    });

    expect(result).toEqual({ ok: true, data: { status: "shipped" } });
    const order = await orderOf();
    expect(order).toMatchObject({ status: "shipped", carrier: "DHL", trackingNumber: "JD0123" });
    expect(order.shippedAt).not.toBeNull();
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: "status_changed",
      fromStatus: "paid",
      toStatus: "shipped",
      actorType: "admin",
      adminId,
      message: "Carrier: DHL, tracking: JD0123",
    });
    // AC-23: ids only, never the tracking number.
    expect(mocks.info).toHaveBeenCalledWith(
      { event: "order.shipped", adminId, orderId: order.id, number: 1001 },
      "order.shipped",
    );
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("JD0123");
  });

  it("saves empty fields as null and writes no message", async () => {
    await seedPaidOrder();

    await markShipped({ ...(await orderRef()), carrier: " ", trackingNumber: "" });

    const order = await orderOf();
    expect(order).toMatchObject({ status: "shipped", carrier: null, trackingNumber: null });
    expect((await eventsOf(order.id)).at(-1)?.message).toBeNull();
  });

  it("writes only the parts given", async () => {
    await seedPaidOrder();
    await markShipped({ ...(await orderRef()), carrier: "", trackingNumber: "X1" });
    expect((await eventsOf((await orderOf()).id)).at(-1)?.message).toBe("Tracking: X1");
  });

  it("refuses a form loaded before the order changed (AC-8)", async () => {
    await seedPaidOrder();
    const ref = await orderRef();
    await addNote({ orderNumber: 1001, note: "notes never conflict" });
    expect(await markShipped({ ...ref, carrier: "", trackingNumber: "" })).toEqual({
      ok: true,
      data: { status: "shipped" },
    });

    expect(await markDelivered(ref)).toEqual(stale);
    expect((await orderOf()).status).toBe("shipped");
  });

  it("refuses an order that is not paid, and a field over 100 characters", async () => {
    await seedPendingOrder();
    expect(await markShipped({ ...(await orderRef()), carrier: "", trackingNumber: "" })).toEqual(
      moved,
    );
    expect(
      await markShipped({ ...(await orderRef()), carrier: "x".repeat(101), trackingNumber: "" }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_input", fields: { carrier: [expect.any(String)] } },
    });
  });

  it("logs a refused action as stale, with no order details", async () => {
    await seedPendingOrder();
    await markShipped({ ...(await orderRef()), carrier: "", trackingNumber: "" });
    expect(mocks.info).toHaveBeenCalledWith(
      {
        event: "order.action_stale",
        adminId,
        number: 1001,
        action: "ship",
        reason: "invalid_transition",
      },
      "order.action_stale",
    );
  });

  it("is refused while a refund is in flight, but a note is not (AC-18)", async () => {
    const { order } = await seedPaidOrder();
    await testDb.refund.create({
      data: { orderId: order.id, amountCents: 100, actorType: "admin", adminId },
    });

    expect(await markShipped({ ...(await orderRef()), carrier: "", trackingNumber: "" })).toEqual({
      ok: false,
      error: { code: "refund_in_progress" },
    });
    expect(await addNote({ orderNumber: 1001, note: "Customer called" })).toMatchObject({
      ok: true,
    });
  });

  it("changes nothing for a visitor the guard turns away (AC-22)", async () => {
    await seedPaidOrder();
    const ref = await orderRef();
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(markShipped({ ...ref, carrier: "", trackingNumber: "" })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect((await orderOf()).status).toBe("paid");
  });
});

describe("markDelivered, undo and tracking (AC-5 to AC-7)", () => {
  async function shipped() {
    await seedPaidOrder();
    await markShipped({ ...(await orderRef()), carrier: "DHL", trackingNumber: "A1" });
  }

  it("delivers a shipped order", async () => {
    await shipped();
    expect(await markDelivered(await orderRef())).toEqual({
      ok: true,
      data: { status: "delivered" },
    });
    const order = await orderOf();
    expect(order.deliveredAt).not.toBeNull();
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      fromStatus: "shipped",
      toStatus: "delivered",
      adminId,
    });
  });

  it("undoes delivered to shipped, then shipped to paid keeping carrier and tracking", async () => {
    await shipped();
    await markDelivered(await orderRef());

    expect(await undoStatus({ ...(await orderRef()), reason: "Wrong order" })).toEqual({
      ok: true,
      data: { status: "shipped" },
    });
    expect((await orderOf()).deliveredAt).toBeNull();
    expect(await undoStatus({ ...(await orderRef()), reason: "Not sent yet" })).toEqual({
      ok: true,
      data: { status: "paid" },
    });
    const order = await orderOf();
    expect(order).toMatchObject({
      status: "paid",
      shippedAt: null,
      carrier: "DHL",
      trackingNumber: "A1",
    });
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      fromStatus: "shipped",
      toStatus: "paid",
      message: "Not sent yet",
    });
  });

  it("needs a reason, and has no undo from paid", async () => {
    await shipped();
    expect(await undoStatus({ ...(await orderRef()), reason: "  " })).toMatchObject({
      ok: false,
      error: { code: "invalid_input", fields: { reason: ["Give a reason."] } },
    });
    await undoStatus({ ...(await orderRef()), reason: "ok" });
    expect(await undoStatus({ ...(await orderRef()), reason: "again" })).toEqual(moved);
  });

  it("edits tracking with the old and new values, and refuses a save that changes nothing", async () => {
    await shipped();

    expect(
      await editTracking({ ...(await orderRef()), carrier: "DHL", trackingNumber: "B2" }),
    ).toEqual({ ok: true, data: null });
    const order = await orderOf();
    expect(order.trackingNumber).toBe("B2");
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: "tracking_updated",
      message: "Tracking: A1 → B2",
    });
    expect(
      await editTracking({ ...(await orderRef()), carrier: "DHL", trackingNumber: "B2" }),
    ).toEqual({
      ok: false,
      error: { code: "invalid_input", fields: { root: ["Nothing changed."] } },
    });
  });

  it("does not edit tracking on a paid order", async () => {
    await seedPaidOrder();
    expect(await editTracking({ ...(await orderRef()), carrier: "X", trackingNumber: "" })).toEqual(
      moved,
    );
  });
});

describe("notes and the attention flag (AC-19, AC-20)", () => {
  it("adds a note to any order without touching updated_at", async () => {
    const { order } = await seedPendingOrder();
    await testDb.order.update({
      where: { id: order.id },
      data: { status: "expired", expiredAt: new Date() },
    });
    const before = (await orderOf()).updatedAt;

    const result = await addNote({ orderNumber: 1001, note: "  Called the customer  " });

    expect(result).toMatchObject({ ok: true });
    expect((await orderOf()).updatedAt).toEqual(before);
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: "note",
      actorType: "admin",
      adminId,
      message: "Called the customer",
    });
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain("Called");
  });

  it("refuses an empty note, one over 1000 characters, and an unknown order", async () => {
    await seedPendingOrder();
    expect(await addNote({ orderNumber: 1001, note: "" })).toMatchObject({ ok: false });
    expect(await addNote({ orderNumber: 1001, note: "x".repeat(1001) })).toMatchObject({
      ok: false,
    });
    expect(await addNote({ orderNumber: 9999, note: "hi" })).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("clears the flag with a note, and refuses when the flag is not set", async () => {
    const { order } = await seedPaidOrder();
    await testDb.order.update({ where: { id: order.id }, data: { needsAttention: true } });

    expect(await resolveAttention({ ...(await orderRef()), note: "Refunded by phone" })).toEqual({
      ok: true,
      data: null,
    });
    expect((await orderOf()).needsAttention).toBe(false);
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: "attention_cleared",
      message: "Refunded by phone",
    });
    expect(await resolveAttention({ ...(await orderRef()), note: "again" })).toEqual(moved);
  });
});

describe("getAdminOrder (AC-21)", () => {
  it("lists history newest first, with the admin's name, and the allowed actions", async () => {
    await seedPaidOrder();
    await markShipped({ ...(await orderRef()), carrier: "", trackingNumber: "" });

    const detail = await getAdminOrder("1001");

    expect(detail?.events.map((event) => [event.type, event.adminName])).toEqual([
      ["status_changed", "Admin"],
      ["status_changed", null],
      ["created", null],
    ]);
    expect(detail?.allowed).toMatchObject({ ship: false, deliver: true, undo: true, refund: true });
    expect(detail?.updatedAt).toBe((await orderOf()).updatedAt.toISOString());
  });
});
