"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import { lockCode } from "@/lib/discounts/codes";
import { env } from "@/lib/env";
import type { ActionResult } from "@/lib/result";

import { logDiscountEvent } from "../log";
import {
  changedDiscountFields,
  changesLockedFields,
  discountCodeFieldsSchema,
  discountCodeRefSchema,
  discountFieldErrors,
} from "../schemas";
import type { DiscountFormError } from "./create-discount-code";

// spec 0014, AC-12, AC-17 and AC-18: saves the code unless it changed since the form loaded it.
// Under the code lock (the one every checkout takes before redeeming), so "has it been used?"
// cannot change between the check and the write.
export async function updateDiscountCode(
  input: unknown,
): Promise<ActionResult<{ readonly id: string }, DiscountFormError>> {
  const admin = await requireAdmin();

  const ref = discountCodeRefSchema.safeParse(input);
  if (!ref.success) return { ok: false, error: { code: "not_found" } };
  const parsed = discountCodeFieldsSchema(env.STORE_CURRENCY, env.STORE_TIMEZONE).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", fields: discountFieldErrors(parsed.error) } };
  }
  const { id, loadedUpdatedAt } = ref.data;
  const fields = parsed.data;

  type Refusal = "not_found" | "stale" | "locked_fields";
  let outcome: Refusal | { readonly changed: readonly string[] };
  try {
    outcome = await db.$transaction(async (tx): Promise<typeof outcome> => {
      if ((await lockCode(tx, { id })) === null) return "not_found";
      const row = await tx.discountCode.findUniqueOrThrow({ where: { id } });
      if (row.updatedAt.getTime() !== loadedUpdatedAt.getTime()) return "stale";
      const redeemed = (await tx.discountRedemption.count({ where: { discountCodeId: id } })) > 0;
      if (redeemed && changesLockedFields(row, fields)) return "locked_fields";
      const changed = changedDiscountFields(row, fields);
      // Prisma's update sets updated_at itself (@updatedAt).
      await tx.discountCode.update({
        where: { id },
        data: { ...fields, updatedByAdminId: admin.id },
        select: { id: true },
      });
      return { changed };
    });
  } catch (error) {
    if (uniqueViolation(error) === null) throw error;
    return { ok: false, error: { code: "code_taken" } };
  }
  if (typeof outcome === "string") return { ok: false, error: { code: outcome } };

  logDiscountEvent("discount.updated", {
    adminId: admin.id,
    discountCodeId: id,
    changed: outcome.changed,
  });
  return { ok: true, data: { id } };
}
