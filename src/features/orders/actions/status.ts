"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import type { OrderStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import * as transitions from "@/lib/orders/transitions";

import { logOrderAdminEvent } from "../admin-log";
import { nothingChangedMessage, type OrderActionError } from "../messages";
import { orderOnlySchema, reasonSchema, trackingSchema } from "../schemas";
import { guard, invalidInput, isError, refused, type Result } from "./guard";

// spec 0010, AC-4 to AC-7: the status moves and the tracking edit.

// AC-4.
export async function markShipped(input: unknown): Result<{ readonly status: OrderStatus }> {
  const admin = await requireAdmin();
  const parsed = trackingSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { carrier, trackingNumber, orderNumber } = parsed.data;

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "ship");
    if (isError(guarded)) return guarded;
    const moved = await transitions.markShipped(tx, {
      orderId: guarded.order.id,
      adminId: admin.id,
      carrier,
      trackingNumber,
    });
    return moved ? guarded.order : ({ code: "invalid_transition" } as const);
  });
  if (isError(outcome)) return refused(admin.id, orderNumber, "ship", outcome);

  logOrderAdminEvent("order.shipped", {
    adminId: admin.id,
    orderId: outcome.id,
    number: outcome.number,
  });
  return { ok: true, data: { status: "shipped" } };
}

// AC-5.
export async function markDelivered(input: unknown): Result<{ readonly status: OrderStatus }> {
  const admin = await requireAdmin();
  const parsed = orderOnlySchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "deliver");
    if (isError(guarded)) return guarded;
    const moved = await transitions.markDelivered(tx, {
      orderId: guarded.order.id,
      adminId: admin.id,
    });
    return moved ? guarded.order : ({ code: "invalid_transition" } as const);
  });
  if (isError(outcome)) return refused(admin.id, parsed.data.orderNumber, "deliver", outcome);

  logOrderAdminEvent("order.delivered", {
    adminId: admin.id,
    orderId: outcome.id,
    number: outcome.number,
  });
  return { ok: true, data: { status: "delivered" } };
}

// AC-6: one step back, shipped to paid or delivered to shipped, with a reason.
export async function undoStatus(input: unknown): Result<{ readonly status: OrderStatus }> {
  const admin = await requireAdmin();
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { reason } = parsed.data;

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "undo");
    if (isError(guarded)) return guarded;
    const { order } = guarded;
    const move = { orderId: order.id, adminId: admin.id, reason };
    const to: OrderStatus = order.status === "delivered" ? "shipped" : "paid";
    const moved =
      order.status === "delivered"
        ? await transitions.revertDelivered(tx, move)
        : await transitions.revertShipped(tx, move);
    return moved ? { order, to } : ({ code: "invalid_transition" } as const);
  });
  if (isError(outcome)) return refused(admin.id, parsed.data.orderNumber, "undo", outcome);

  logOrderAdminEvent("order.status_reverted", {
    adminId: admin.id,
    orderId: outcome.order.id,
    number: outcome.order.number,
    from: outcome.order.status,
    to: outcome.to,
  });
  return { ok: true, data: { status: outcome.to } };
}

// AC-7.
export async function editTracking(input: unknown): Result<null> {
  const admin = await requireAdmin();
  const parsed = trackingSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { carrier, trackingNumber } = parsed.data;

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "editTracking");
    if (isError(guarded)) return guarded;
    const { order } = guarded;
    const message = transitions.trackingChangeMessage(order, { carrier, trackingNumber });
    if (message === null) {
      return {
        code: "invalid_input",
        fields: { root: [nothingChangedMessage] },
      } as const satisfies OrderActionError;
    }
    await tx.$executeRaw`
      UPDATE orders SET carrier = ${carrier}, tracking_number = ${trackingNumber},
                        updated_at = now()
      WHERE id = ${order.id}::uuid`;
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "tracking_updated",
        actorType: "admin",
        adminId: admin.id,
        message,
      },
    });
    return order;
  });
  if (isError(outcome)) {
    return refused(admin.id, parsed.data.orderNumber, "editTracking", outcome);
  }

  logOrderAdminEvent("order.tracking_updated", {
    adminId: admin.id,
    orderId: outcome.id,
    number: outcome.number,
  });
  return { ok: true, data: null };
}
