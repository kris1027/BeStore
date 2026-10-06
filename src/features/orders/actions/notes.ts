"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";

import { logOrderAdminEvent } from "../admin-log";
import { noteSchema, resolveSchema } from "../schemas";
import { guard, invalidInput, isError, refused, type Result } from "./guard";

// spec 0010, AC-19 and AC-20: notes and the attention flag.

// AC-19: any order, any status, no stale check (notes never conflict) and no updated_at bump.
export async function addNote(input: unknown): Result<{ readonly eventId: string }> {
  const admin = await requireAdmin();
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const order = await db.order.findUnique({
    where: { number: parsed.data.orderNumber },
    select: { id: true, number: true },
  });
  if (!order) return { ok: false, error: { code: "not_found" } };
  const event = await db.orderEvent.create({
    data: {
      orderId: order.id,
      type: "note",
      actorType: "admin",
      adminId: admin.id,
      message: parsed.data.note,
    },
    select: { id: true },
  });

  logOrderAdminEvent("order.note_added", {
    adminId: admin.id,
    orderId: order.id,
    number: order.number,
  });
  return { ok: true, data: { eventId: event.id } };
}

// AC-20.
export async function resolveAttention(input: unknown): Result<null> {
  const admin = await requireAdmin();
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const outcome = await db.$transaction(async (tx) => {
    const guarded = await guard(tx, parsed.data, "resolve");
    if (isError(guarded)) return guarded;
    const { order } = guarded;
    await tx.$executeRaw`
      UPDATE orders SET needs_attention = false, updated_at = now()
      WHERE id = ${order.id}::uuid`;
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "attention_cleared",
        actorType: "admin",
        adminId: admin.id,
        message: parsed.data.note,
      },
    });
    return order;
  });
  if (isError(outcome)) return refused(admin.id, parsed.data.orderNumber, "resolve", outcome);

  logOrderAdminEvent("order.attention_cleared", {
    adminId: admin.id,
    orderId: outcome.id,
    number: outcome.number,
  });
  return { ok: true, data: null };
}
