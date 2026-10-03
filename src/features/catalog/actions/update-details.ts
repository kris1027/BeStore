"use server";

import { updateTag } from "next/cache";

import { requireAdmin } from "@/features/admin-auth/require-admin";
import { catalogTag, productTag } from "@/lib/cache-tags";
import { db } from "@/lib/db";
import { uniqueViolation } from "@/lib/db-errors";
import type { ActionResult } from "@/lib/result";

import { logCatalogEvent } from "../log";
import { detailsSchema, pathErrors } from "../schemas";

export type UpdateDetailsError =
  | { readonly code: "validation"; readonly fields: Record<string, readonly string[]> }
  | { readonly code: "slug_taken" }
  | { readonly code: "stale" }
  | { readonly code: "not_found" };

// spec 0009, AC-5 and AC-21: saves the Details section unless the product changed since the
// page loaded it. Only Details and status saves touch the products row (arranging rewrites
// position in raw SQL), so its updated_at is this section's conflict token.
export async function updateProductDetails(
  input: unknown,
): Promise<ActionResult<{ readonly slug: string }, UpdateDetailsError>> {
  const admin = await requireAdmin();

  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "validation", fields: pathErrors(parsed.error) } };
  }
  const { productId, loadedUpdatedAt, ...details } = parsed.data;

  let outcome: { readonly ok: true; readonly oldSlug: string } | UpdateDetailsError;
  try {
    outcome = await db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ slug: string; updated_at: Date }[]>`
        SELECT slug, updated_at FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
      if (!row) return { code: "not_found" } as const;
      if (row.updated_at.getTime() !== loadedUpdatedAt.getTime()) return { code: "stale" } as const;
      await tx.product.update({
        where: { id: productId },
        data: details,
        select: { id: true },
      });
      return { ok: true, oldSlug: row.slug } as const;
    });
  } catch (error) {
    if (uniqueViolation(error) === null) throw error;
    return { ok: false, error: { code: "slug_taken" } };
  }
  if (!("ok" in outcome)) return { ok: false, error: outcome };

  // After the commit, both slugs: the old page must 404 and the new one must render (AC-5).
  updateTag(catalogTag);
  updateTag(productTag(outcome.oldSlug));
  if (outcome.oldSlug !== details.slug) updateTag(productTag(details.slug));
  logCatalogEvent("catalog.product.updated", {
    adminId: admin.id,
    productId,
    section: "details",
  });
  return { ok: true, data: { slug: details.slug } };
}
