"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import type { ActionResult } from "@/lib/result";

import { logCatalogEvent } from "../log";
import { statusChangeSchema } from "../schemas";
import { canTransition, type ProductStatus, publishPosition } from "../status";

export type ChangeStatusError =
  | { readonly code: "invalid_transition" }
  | { readonly code: "no_variants" }
  | { readonly code: "not_found" };

// spec 0009, AC-2 and AC-3: publish, hide, archive and restore. The product row is locked, so
// the transition is judged against the status it really moves from.
export async function changeProductStatus(
  input: unknown,
): Promise<ActionResult<{ readonly status: ProductStatus }, ChangeStatusError>> {
  const admin = await requireAdmin();

  const parsed = statusChangeSchema.safeParse(input);
  // Only the status buttons call this, so a malformed request is treated as a bad transition.
  if (!parsed.success) return { ok: false, error: { code: "invalid_transition" } };
  const { productId, to } = parsed.data;

  const outcome = await db.$transaction(
    async (tx): Promise<{ from: ProductStatus; slug: string } | ChangeStatusError> => {
      const [row] = await tx.$queryRaw<{ status: ProductStatus; slug: string }[]>`
        SELECT status, slug FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
      if (!row) return { code: "not_found" };
      if (!canTransition(row.status, to)) return { code: "invalid_transition" };

      if (to !== "active") {
        await tx.product.update({ where: { id: productId }, data: { status: to } });
        return { from: row.status, slug: row.slug };
      }

      // AC-2: a live product needs at least one variant a customer can pick.
      const variants = await tx.productVariant.count({ where: { productId, archived: false } });
      if (variants === 0) return { code: "no_variants" };
      // Read at this moment, so arranging keeps working: two publishes at once may share a
      // position, and the newest first tiebreak orders them (AC-3).
      const lowest = await tx.product.aggregate({
        where: { status: "active" },
        _min: { position: true },
      });
      await tx.product.update({
        where: { id: productId },
        data: { status: "active", position: publishPosition(lowest._min.position) },
      });
      return { from: row.status, slug: row.slug };
    },
  );
  if ("code" in outcome) return { ok: false, error: outcome };

  updateTag(catalogTag);
  updateTag(productTag(outcome.slug));
  logCatalogEvent("catalog.product.status_changed", {
    adminId: admin.id,
    productId,
    from: outcome.from,
    to,
  });
  return { ok: true, data: { status: to } };
}
