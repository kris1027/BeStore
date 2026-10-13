import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SendResult, Transport } from "@/lib/email/transport";

import { resetDatabaseBeforeEach, testDb } from "./client";
import { createAdmin } from "./fixtures";
import {
  orderOf,
  orderRef,
  refundEvent,
  refundsOf,
  seedPaidOrder,
  stripeRefund,
} from "./order-support";
import {
  autoPaging,
  eventsOf,
  seedPendingOrder,
  sessionEvent,
  signedRequest,
} from "./stripe-support";

// Order emails against a real Postgres (spec 0011): the outbox rows each path queues, delivery
// with the log transport and a stubbed one, the daily sweep, and Send again. scheduleDelivery is
// replaced (after() needs a request scope); each test delivers the rows itself.

const mocks = vi.hoisted(() => ({
  scheduleDelivery: vi.fn(),
  requireAdmin: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  list: vi.fn(),
  failAfterPaid: false,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/email/schedule", () => ({ scheduleDelivery: mocks.scheduleDelivery }));
vi.mock("@/lib/db", async () => ({ db: (await import("./client")).testDb }));
vi.mock("@/lib/env", () => ({
  env: {
    STORE_LOCALE: "en",
    STORE_TIMEZONE: "Europe/Warsaw",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    CRON_SECRET: "s".repeat(32),
    EMAIL_TRANSPORT: "log",
    EMAIL_FROM: "BeStore <orders@example.com>",
    EMAIL_FROM_ADDRESS: "orders@example.com",
  },
}));
vi.mock("@/lib/stripe", async () => ({
  stripe: {
    refunds: { create: mocks.create, retrieve: mocks.retrieve, list: mocks.list },
    checkout: { sessions: { retrieve: vi.fn(), expire: vi.fn() } },
    events: { list: () => autoPaging([]) },
    webhooks: (await import("./stripe-support")).offlineStripe.webhooks,
  },
  stripeDashboardUrl: () => "https://dashboard",
}));
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
vi.mock("@/lib/orders/transitions", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/orders/transitions")>();
  return {
    ...original,
    markPaid: async (...args: Parameters<typeof original.markPaid>) => {
      const paid = await original.markPaid(...args);
      if (mocks.failAfterPaid) throw new Error("boom after the writes");
      return paid;
    },
  };
});

const { stripeWebhookRequest } = await import("@/features/orders/webhook");
const { markShipped, undoStatus, editTracking, markDelivered } =
  await import("@/features/orders/actions/status");
const { refundOrder } = await import("@/features/orders/actions/refund");
const { cancelOrder } = await import("@/features/orders/actions/cancel");
const { sendEmailAgain } = await import("@/features/orders/actions/emails");
const { syncRefund } = await import("@/features/orders/refund-sync");
const { reconcileOrdersRequest } = await import("@/features/orders/reconcile");
const { deliver, deliverWithRetry, failureNote } = await import("@/lib/email/deliver");
const { sweepEmails, EMAIL_GIVE_UP_MS } = await import("@/lib/email/sweep");
const { enqueueEmail } = await import("@/lib/email/enqueue");

resetDatabaseBeforeEach();

let adminId = "";

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.failAfterPaid = false;
  adminId = (await createAdmin()).id;
  mocks.requireAdmin.mockResolvedValue({ id: adminId, email: "admin@example.com", name: "Admin" });
  mocks.list.mockReturnValue(autoPaging([]));
});

// A transport that answers each send in turn and records what it was given.
function stubTransport(...answers: SendResult[]) {
  const sent: Parameters<Transport["send"]>[0][] = [];
  const transport: Transport = {
    name: "resend",
    send: async (email) => {
      sent.push(email);
      return answers.shift() ?? { ok: true, resendId: "re_email_default" };
    },
  };
  return { transport, sent };
}

const refused = (name: string, statusCode: number | null): SendResult => ({
  ok: false,
  failure: { name, statusCode },
});

async function emailsOf(orderId: string) {
  return testDb.emailSend.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
}

async function onlyEmail(orderId: string) {
  const rows = await emailsOf(orderId);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function scheduledIds(): string[] {
  return mocks.scheduleDelivery.mock.calls.flatMap(([ids]) =>
    (ids as (string | null)[]).filter((id): id is string => id !== null),
  );
}

async function post(event: Parameters<typeof signedRequest>[0]) {
  const response = await stripeWebhookRequest(signedRequest(event));
  return response.status;
}

function stripeAnswers(status: string) {
  mocks.create.mockImplementation(
    async (params: { amount: number; metadata: { refund_id: string } }) =>
      stripeRefund({ status, amount: params.amount, refundId: params.metadata.refund_id }),
  );
}

async function paidOrder() {
  const seeded = await seedPaidOrder({ stock: 5, quantity: 2 });
  await testDb.order.update({
    where: { id: seeded.order.id },
    data: {
      customerName: "Ada Lovelace",
      shipFullName: "Ada Lovelace",
      shipLine1: "ul. Długa 12",
      shipPostalCode: "00-238",
      shipCity: "Warszawa",
      shipCountryCode: "PL",
    },
  });
  // seedPaidOrder pays through markPaid directly, which queues nothing; only the webhook does.
  const line = await testDb.orderLine.findFirstOrThrow({ where: { orderId: seeded.order.id } });
  return { ...seeded, line };
}

// An outbox row as a path would queue it, for the delivery and sweep tests.
async function queued(
  orderId: string,
  kind: "order_confirmation" | "order_shipped" = "order_confirmation",
) {
  const id = await testDb.$transaction((tx) => enqueueEmail(tx, { orderId, kind }));
  if (id === null) throw new Error("not queued");
  return id;
}

describe("the confirmation (AC-1, AC-8, AC-16)", () => {
  it("queues one row in the paid transaction, schedules it, and the log transport sends it", async () => {
    const { order } = await seedPendingOrder();
    const event = sessionEvent("checkout.session.completed", {
      orderId: order.id,
      amountTotal: 5000,
    });

    expect(await post(event)).toBe(200);

    const row = await onlyEmail(order.id);
    expect(row).toMatchObject({
      kind: "order_confirmation",
      dedupeKey: `order_confirmation:${order.id}`,
      status: "pending",
      refundId: null,
      attempts: 0,
      cancelledWording: false,
    });
    expect(scheduledIds()).toEqual([row.id]);

    expect(await deliverWithRetry(row.id, { waits: [0, 0] })).toBe("sent");
    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "sent",
      resendId: null,
      attempts: 1,
      errorCode: null,
    });
    const sentLog = mocks.info.mock.calls.find(([entry]) => entry.event === "email.sent");
    expect(sentLog?.[0]).toMatchObject({
      transport: "log",
      emailSendId: row.id,
      orderNumber: 1001,
    });

    // A duplicate event queues nothing new.
    mocks.scheduleDelivery.mockClear();
    expect(await post(event)).toBe(200);
    expect(await emailsOf(order.id)).toHaveLength(1);
    expect(scheduledIds()).toEqual([]);
  });

  it("queues nothing and schedules nothing when the paid transaction rolls back", async () => {
    const { order } = await seedPendingOrder();
    mocks.failAfterPaid = true;

    expect(await post(sessionEvent("checkout.session.completed", { orderId: order.id }))).toBe(500);

    expect(await emailsOf(order.id)).toEqual([]);
    expect(mocks.scheduleDelivery).not.toHaveBeenCalled();
  });

  it("still queues the confirmation for an order flagged on payment", async () => {
    const { order } = await seedPendingOrder();

    await post(sessionEvent("checkout.session.completed", { orderId: order.id, amountTotal: 1 }));

    expect((await orderOf()).needsAttention).toBe(true);
    expect((await onlyEmail(order.id)).kind).toBe("order_confirmation");
  });

  it("queues nothing for a late payment on a cancelled order", async () => {
    const { order } = await seedPendingOrder();
    await testDb.order.update({ where: { id: order.id }, data: { status: "cancelled" } });

    await post(sessionEvent("checkout.session.completed", { orderId: order.id }));

    expect(await emailsOf(order.id)).toEqual([]);
  });
});

describe("shipped (AC-2)", () => {
  it("queues one shipped email however often the order ships", async () => {
    const { order } = await paidOrder();

    await markShipped({ ...(await orderRef()), carrier: "DHL", trackingNumber: "JD1" });
    const row = await onlyEmail(order.id);
    expect(row).toMatchObject({ kind: "order_shipped", dedupeKey: `order_shipped:${order.id}` });
    expect(scheduledIds()).toEqual([row.id]);

    await undoStatus({ ...(await orderRef()), reason: "Wrong order" });
    await markShipped({ ...(await orderRef()), carrier: "DHL", trackingNumber: "JD2" });
    await editTracking({ ...(await orderRef()), carrier: "DHL", trackingNumber: "JD3" });
    await markDelivered(await orderRef());

    expect(await emailsOf(order.id)).toHaveLength(1);
    expect(scheduledIds()).toEqual([row.id]);
  });

  it("renders the carrier and tracking number at send time", async () => {
    const { order } = await paidOrder();
    await markShipped({ ...(await orderRef()), carrier: "DHL", trackingNumber: "JD1" });
    await editTracking({ ...(await orderRef()), carrier: "InPost", trackingNumber: "IP9" });
    const { transport, sent } = stubTransport();

    await deliver((await onlyEmail(order.id)).id, transport);

    expect(sent[0]).toMatchObject({
      to: "ada@example.com",
      subject: "Order #1001 is on its way",
      idempotencyKey: `order_shipped:${order.id}`,
    });
    expect(sent[0]?.text).toContain("Carrier: InPost, tracking number: IP9");
  });
});

describe("refunds (AC-3, AC-6)", () => {
  it("queues one email for an admin refund settled by Stripe's reply", async () => {
    const { order, line } = await paidOrder();
    stripeAnswers("succeeded");

    await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 1, restock: false }],
      refundShipping: false,
      amount: "25.00",
      reason: "Too small",
    });

    const [refund] = await refundsOf(order.id);
    const row = await onlyEmail(order.id);
    expect(row).toMatchObject({
      kind: "order_refunded",
      refundId: refund?.id,
      dedupeKey: `order_refunded:${refund?.id}`,
      cancelledWording: false,
    });
    expect(scheduledIds()).toEqual([row.id]);

    const { transport, sent } = stubTransport();
    await deliver(row.id, transport);
    expect(sent[0]?.subject).toBe("Refund for order #1001");
    expect(sent[0]?.text).toContain("€25.00");
    // Never the admin's reason.
    expect(sent[0]?.html).not.toContain("Too small");
  });

  it("queues nothing for a pending refund, then one when the sync settles it", async () => {
    const { order, line } = await paidOrder();
    stripeAnswers("pending");
    await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 1, restock: false }],
      refundShipping: false,
      amount: "10",
      reason: "Goodwill",
    });
    expect(await emailsOf(order.id)).toEqual([]);

    const [refund] = await refundsOf(order.id);
    mocks.retrieve.mockResolvedValue(
      stripeRefund({ id: refund!.stripeRefundId!, status: "succeeded", amount: 1000 }),
    );
    await syncRefund(refund!.id, Date.now());

    const row = await onlyEmail(order.id);
    expect(row.refundId).toBe(refund!.id);
    expect(scheduledIds()).toEqual([row.id]);
  });

  it("queues a dashboard refund from the webhook, without the cancel wording on a partial one", async () => {
    const { order } = await paidOrder();
    await testDb.order.update({ where: { id: order.id }, data: { status: "cancelled" } });

    await post(
      refundEvent(
        "refund.created",
        stripeRefund({ status: "succeeded", amount: 1000, refundId: null }),
      ),
    );

    const [refund] = await refundsOf(order.id);
    expect(refund).toMatchObject({ actorType: "system", status: "succeeded" });
    const row = await onlyEmail(order.id);
    expect(row).toMatchObject({ refundId: refund!.id, cancelledWording: false });
  });

  it("does not queue twice when a failed refund comes back succeeded and the event replays", async () => {
    const { order, line } = await paidOrder();
    stripeAnswers("failed");
    await refundOrder({
      ...(await orderRef()),
      lines: [{ orderLineId: line.id, quantity: 1, restock: false }],
      refundShipping: false,
      amount: "10",
      reason: "Goodwill",
    });
    const [refund] = await refundsOf(order.id);
    expect(refund?.status).toBe("failed");
    expect(await emailsOf(order.id)).toEqual([]);

    const succeeded = stripeRefund({
      id: refund!.stripeRefundId!,
      status: "succeeded",
      amount: 1000,
    });
    await post(refundEvent("refund.updated", succeeded, "evt_back"));
    await post(refundEvent("refund.updated", succeeded, "evt_again"));

    expect((await onlyEmail(order.id)).refundId).toBe(refund!.id);
  });

  it("freezes the cancel wording on a paid cancel refunded in full", async () => {
    const { order } = await paidOrder();
    stripeAnswers("succeeded");

    await cancelOrder({ ...(await orderRef()), reason: "Changed their mind", restockLineIds: [] });

    const row = await onlyEmail(order.id);
    expect(row.cancelledWording).toBe(true);
    const { transport, sent } = stubTransport();
    await deliver(row.id, transport);
    expect(sent[0]?.subject).toBe("Order #1001 cancelled and refunded");
    expect(sent[0]?.text).toContain("Your order was cancelled and refunded in full.");
  });
});

describe("delivery and retries (AC-8 to AC-10)", () => {
  it("leaves the row pending after two failed tries, and the sweep sends it later", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    const down = stubTransport(
      refused("internal_server_error", 500),
      refused("application_error", null),
    );

    expect(await deliverWithRetry(id, { waits: [0, 0], transport: down.transport })).toBe("retry");
    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "pending",
      attempts: 2,
      errorCode: "application_error",
    });

    const later = Date.now() + 24 * 60 * 60 * 1000 - EMAIL_GIVE_UP_MS + 3 * 60 * 1000;
    const up = stubTransport({ ok: true, resendId: "re_email_1" });
    const counts = await sweepEmails(Number.POSITIVE_INFINITY, {
      nowMs: later,
      transport: up.transport,
    });

    expect(counts).toMatchObject({ sent: 1, gaveUp: 0 });
    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "sent",
      resendId: "re_email_1",
      attempts: 3,
      errorCode: null,
    });
  });

  // covers: AC-8 (a 500 then success sends on the second try)
  it("sends on the second try after a server error, and stops there", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    const flaky = stubTransport(refused("internal_server_error", 500), {
      ok: true,
      resendId: "re_email_2",
    });

    expect(await deliverWithRetry(id, { waits: [0, 0, 0], transport: flaky.transport })).toBe(
      "sent",
    );
    expect(flaky.sent).toHaveLength(2);
    expect(flaky.sent.map((email) => email.idempotencyKey)).toEqual([
      `order_confirmation:${order.id}`,
      `order_confirmation:${order.id}`,
    ]);
    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "sent",
      resendId: "re_email_2",
      attempts: 2,
      errorCode: null,
    });
  });

  // covers: AC-8 (a final refusal is not tried again in process)
  it("does not try again after a final refusal", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    const refusing = stubTransport(refused("validation_error", 422));

    expect(await deliverWithRetry(id, { waits: [0, 0], transport: refusing.transport })).toBe(
      "failed",
    );
    expect(refusing.sent).toHaveLength(1);
  });

  // covers: AC-8, AC-17 (a thrown error leaves the row for the sweep and logs no content)
  it("keeps the row pending when a try throws, and logs only the error's name", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    const throwing: Transport = {
      name: "resend",
      send: async () => {
        throw new TypeError("fetch failed for ada@example.com");
      },
    };

    expect(await deliverWithRetry(id, { waits: [0, 0], transport: throwing })).toBe("retry");
    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "pending",
      attempts: 2,
    });
    const errors = mocks.error.mock.calls.filter(
      ([fields]) => (fields as { event?: string }).event === "email.retry",
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]![0]).toMatchObject({ emailSendId: id, errorName: "TypeError" });
    expect(JSON.stringify(errors)).not.toContain("ada@example.com");
  });

  it("fails a refused address, flags the order and notes it once", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    const { transport } = stubTransport(refused("validation_error", 422));

    expect((await deliver(id, transport)).outcome).toBe("failed");

    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "failed",
      errorCode: "validation_error",
    });
    expect((await orderOf()).needsAttention).toBe(true);
    const notes = (await eventsOf(order.id)).filter(
      (e) => e.message === failureNote("order_confirmation"),
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "note", actorType: "system" });
  });

  it("keeps a config error pending and visible", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    const { transport } = stubTransport(refused("invalid_api_key", 403));

    expect(await deliver(id, transport)).toEqual({ outcome: "retry", stopSweep: true });

    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "pending",
      errorCode: "invalid_api_key",
    });
    expect(mocks.error.mock.calls.some(([entry]) => entry.event === "email.config_error")).toBe(
      true,
    );
  });

  it("counts a used key with a different payload as sent", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    const { transport } = stubTransport(refused("invalid_idempotent_request", 409));

    expect((await deliver(id, transport)).outcome).toBe("sent");

    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "sent",
      resendId: null,
      errorCode: "idempotent_conflict",
    });
  });

  it("lets two workers send one row at once, and only one settles it", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    const { transport, sent } = stubTransport(
      { ok: true, resendId: "re_a" },
      { ok: true, resendId: "re_b" },
    );

    const results = await Promise.all([deliver(id, transport), deliver(id, transport)]);

    const outcomes = results.map((r) => r.outcome).toSorted();
    // Either both tried (the shared key makes Resend deliver once) and one settled, or the
    // second found the row already settled before its try.
    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
    expect(sent.every((email) => email.idempotencyKey === `order_confirmation:${order.id}`)).toBe(
      true,
    );
    expect((await testDb.emailSend.findUniqueOrThrow({ where: { id } })).status).toBe("sent");
  });

  it("fails a row whose order email was purged, without flagging the order (AC-12)", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    await testDb.$executeRaw`
      UPDATE orders SET status = 'expired', expired_at = now(), email = NULL, customer_name = NULL,
             pii_purged_at = now()
      WHERE id = ${order.id}::uuid`;
    const { transport, sent } = stubTransport();

    expect((await deliver(id, transport)).outcome).toBe("failed");

    expect(sent).toEqual([]);
    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "failed",
      errorCode: "email_missing",
    });
    expect((await orderOf()).needsAttention).toBe(false);
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({ type: "note", actorType: "system" });
    expect(mocks.warn.mock.calls.some(([entry]) => entry.event === "order.email_missing")).toBe(
      true,
    );
  });
});

describe("the daily sweep (AC-11)", () => {
  it("gives up on a row queued 23 hours ago, flags the order and notes it once", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    const now = Date.now() + EMAIL_GIVE_UP_MS + 1000;

    expect(await sweepEmails(Number.POSITIVE_INFINITY, { nowMs: now })).toMatchObject({
      gaveUp: 1,
    });
    expect(await testDb.emailSend.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "failed",
      errorCode: "gave_up",
    });
    expect((await orderOf()).needsAttention).toBe(true);

    expect(await sweepEmails(Number.POSITIVE_INFINITY, { nowMs: now })).toMatchObject({
      gaveUp: 0,
    });
    const notes = (await eventsOf(order.id)).filter(
      (e) => e.message === failureNote("order_confirmation"),
    );
    expect(notes).toHaveLength(1);
  });

  it("leaves a row queued a minute ago alone, and stops at a 429", async () => {
    const first = await paidOrder();
    const old1 = await queued(first.order.id);
    const old2 = await queued(first.order.id, "order_shipped");
    await testDb.$executeRaw`
      UPDATE email_sends SET queued_at = now() - interval '10 minutes' WHERE id IN (${old1}::uuid, ${old2}::uuid)`;
    const fresh = await seedPendingOrder({ suffix: "2" });
    const freshId = await queued(fresh.order.id);
    const { transport, sent } = stubTransport(refused("rate_limit_exceeded", 429));

    const counts = await sweepEmails(Number.POSITIVE_INFINITY, { transport });

    expect(counts).toMatchObject({ retry: 1, sent: 0 });
    expect(sent).toHaveLength(1);
    const rows = await testDb.emailSend.findMany({ select: { id: true, attempts: true } });
    expect(rows.find((r) => r.id === freshId)?.attempts).toBe(0);
    expect(rows.reduce((sum, r) => sum + r.attempts, 0)).toBe(1);
  });

  it("runs first in the reconcile cron and logs its counts", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    await testDb.$executeRaw`UPDATE email_sends SET queued_at = now() - interval '10 minutes' WHERE id = ${id}::uuid`;

    const response = await reconcileOrdersRequest(
      new Request("http://localhost/api/cron/reconcile-orders", {
        headers: { authorization: `Bearer ${"s".repeat(32)}` },
      }),
    );

    expect(response.status).toBe(200);
    expect((await testDb.emailSend.findUniqueOrThrow({ where: { id } })).status).toBe("sent");
    const sweep = mocks.info.mock.calls.find(([entry]) => entry.event === "cron.email_sweep");
    expect(sweep?.[0]).toMatchObject({ sent: 1, gaveUp: 0, retry: 0, failed: 0, skipped: 0 });
  });
});

describe("sendEmailAgain (AC-13 to AC-15)", () => {
  async function failedRow() {
    const { order } = await paidOrder();
    const id = await queued(order.id);
    await deliver(id, stubTransport(refused("validation_error", 422)).transport);
    return { order, id };
  }

  it("queues a failed email again and the next delivery sends it", async () => {
    const { order, id } = await failedRow();

    expect(await sendEmailAgain({ orderNumber: 1001, emailSendId: id })).toEqual({
      ok: true,
      data: { status: "pending" },
    });

    const row = await testDb.emailSend.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      status: "pending",
      errorCode: null,
      lastAttemptAt: null,
      attempts: 1,
    });
    expect(scheduledIds()).toEqual([id]);
    expect((await eventsOf(order.id)).at(-1)).toMatchObject({
      type: "note",
      actorType: "admin",
      adminId,
      message: "Order confirmation email queued again",
    });
    // The flag stays for Mark resolved.
    expect((await orderOf()).needsAttention).toBe(true);

    expect((await deliver(id, stubTransport().transport)).outcome).toBe("sent");
  });

  it("refuses a row that is no longer failed", async () => {
    const { order } = await paidOrder();
    const id = await queued(order.id);

    expect(await sendEmailAgain({ orderNumber: 1001, emailSendId: id })).toEqual({
      ok: false,
      error: { code: "email_changed" },
    });
    expect((await testDb.emailSend.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  });

  it("refuses a row from another order", async () => {
    const { id } = await failedRow();
    await seedPendingOrder({ suffix: "2" });

    expect(await sendEmailAgain({ orderNumber: 1002, emailSendId: id })).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    expect((await testDb.emailSend.findUniqueOrThrow({ where: { id } })).status).toBe("failed");
  });

  it("changes nothing for a visitor who is not an active admin", async () => {
    const { id } = await failedRow();
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(sendEmailAgain({ orderNumber: 1001, emailSendId: id })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect((await testDb.emailSend.findUniqueOrThrow({ where: { id } })).status).toBe("failed");
  });

  it("rejects malformed input", async () => {
    expect(await sendEmailAgain({ orderNumber: 1001, emailSendId: "nope" })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });
});

describe("logs (AC-17)", () => {
  it("never carry a recipient, a subject, a name or an address", async () => {
    const { order } = await seedPendingOrder();
    await testDb.order.update({
      where: { id: order.id },
      data: { customerName: "Ada Lovelace", shipLine1: "ul. Długa 12" },
    });
    await post(
      sessionEvent("checkout.session.completed", { orderId: order.id, amountTotal: 5000 }),
    );
    const id = (await onlyEmail(order.id)).id;
    await deliver(id, stubTransport(refused("internal_server_error", 500)).transport);
    await deliver(id, stubTransport().transport);

    const logged = JSON.stringify([
      mocks.info.mock.calls,
      mocks.warn.mock.calls,
      mocks.error.mock.calls,
    ]);
    expect(logged).toContain("email.queued");
    expect(logged).toContain("email.retry");
    expect(logged).toContain("email.sent");
    expect(logged).not.toContain("ada@example.com");
    expect(logged).not.toContain("confirmed");
    expect(logged).not.toContain("Ada");
    expect(logged).not.toContain("Długa");
  });
});
