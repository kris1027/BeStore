"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import { lockCode } from "@/lib/discounts/codes";
import type { ActionResult } from "@/lib/result";

import { logDiscountEvent } from "../log";
import { deleteDiscountCodeSchema } from "../schemas";

export type DeleteDiscountError = { readonly code: "used" } | { readonly code: "not_found" };

// spec 0014, AC-13 and AC-17: only a code never used. Rechecked under the code lock, which every
// checkout takes before redeeming. Orders that once pointed at it (expired or cancelled while
// pending) keep their snapshot text; the foreign key sets their link to null.
export async function deleteDiscountCode(
  input: unknown,
): Promise<ActionResult<null, DeleteDiscountError>> {
  const admin = await requireAdmin();

  const parsed = deleteDiscountCodeSchema.safeParse(input);
  // Only the delete button calls this, so a malformed request reads as a missing code.
  if (!parsed.success) return { ok: false, error: { code: "not_found" } };
  const { id } = parsed.data;

  const outcome = await db.$transaction(async (tx) => {
    if ((await lockCode(tx, { id })) === null) return "not_found" as const;
    if ((await tx.discountRedemption.count({ where: { discountCodeId: id } })) > 0) {
      return "used" as const;
    }
    await tx.discountCode.delete({ where: { id }, select: { id: true } });
    return "deleted" as const;
  });
  if (outcome !== "deleted") return { ok: false, error: { code: outcome } };

  logDiscountEvent("discount.deleted", { adminId: admin.id, discountCodeId: id });
  return { ok: true, data: null };
}
