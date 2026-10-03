import "server-only";

import type { Tx } from "@/lib/db";

// The stock history (spec 0009, AC-11): every change to product_variants.stock_quantity writes
// one row in the same transaction, and stock_after equals the new stock_quantity. Shared by the
// catalog actions and the paid order transition, so it lives here rather than in a feature.
// Each kind carries only the fields its CHECKs allow, so a wrong row fails to compile before it
// can fail in Postgres.

export type MovementRow =
  | {
      // A variant's opening count: at create, from a new option value, or the migration.
      readonly kind: "initial";
      readonly variantId: string;
      readonly stockAfter: number;
      readonly adminId: string;
    }
  | {
      readonly kind: "adjustment";
      readonly variantId: string;
      readonly delta: number;
      readonly stockAfter: number;
      readonly adminId: string;
      readonly note: string | null;
    }
  | {
      // What a paid order really took; never written for a sale that took nothing.
      readonly kind: "sale";
      readonly variantId: string;
      readonly delta: number;
      readonly stockAfter: number;
      readonly orderId: string;
    };

function columns(row: MovementRow) {
  switch (row.kind) {
    case "initial":
      return {
        variantId: row.variantId,
        kind: row.kind,
        delta: row.stockAfter,
        stockAfter: row.stockAfter,
        actorType: "admin" as const,
        adminId: row.adminId,
      };
    case "adjustment":
      return {
        variantId: row.variantId,
        kind: row.kind,
        delta: row.delta,
        stockAfter: row.stockAfter,
        actorType: "admin" as const,
        adminId: row.adminId,
        note: row.note,
      };
    case "sale":
      return {
        variantId: row.variantId,
        kind: row.kind,
        delta: row.delta,
        stockAfter: row.stockAfter,
        actorType: "system" as const,
        orderId: row.orderId,
      };
  }
}

export async function recordMovements(tx: Tx, rows: readonly MovementRow[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.stockMovement.createMany({ data: rows.map(columns) });
}
