"use server";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { db } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import { env } from "@/lib/env";
import type { ActionResult } from "@/lib/result";

import { logDiscountEvent } from "../log";
import {
  type DiscountFieldErrors,
  discountCodeFieldsSchema,
  discountFieldErrors,
} from "../schemas";

export type DiscountFormError =
  | { readonly code: "validation"; readonly fields: DiscountFieldErrors }
  | { readonly code: "code_taken" }
  | { readonly code: "locked_fields" }
  | { readonly code: "stale" }
  | { readonly code: "not_found" };

// spec 0014, AC-11 and AC-17: a new code, created by this admin.
export async function createDiscountCode(
  input: unknown,
): Promise<ActionResult<{ readonly id: string }, DiscountFormError>> {
  const admin = await requireAdmin();

  const parsed = discountCodeFieldsSchema(env.STORE_CURRENCY, env.STORE_TIMEZONE).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", fields: discountFieldErrors(parsed.error) } };
  }

  let id: string;
  try {
    ({ id } = await db.discountCode.create({
      data: { ...parsed.data, createdByAdminId: admin.id },
      select: { id: true },
    }));
  } catch (error) {
    if (uniqueViolation(error) === null) throw error;
    return { ok: false, error: { code: "code_taken" } };
  }

  logDiscountEvent("discount.created", { adminId: admin.id, discountCodeId: id });
  return { ok: true, data: { id } };
}
