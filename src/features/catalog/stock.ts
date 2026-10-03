// Pure rules of the Stock section (spec 0009, AC-10, AC-11).

export type StockRowInput = {
  readonly variantId: string;
  // The count the page showed when the admin started typing.
  readonly expected: number;
  readonly next: number;
  readonly note: string;
};

export type StockChange = {
  readonly variantId: string;
  readonly expected: number;
  readonly next: number;
  readonly note: string | null;
};

// Rows whose new count equals the shown count are skipped, and a note on them is dropped.
// Sorted by variant id, so two saves lock the same rows in the same order and never deadlock.
export function stockChanges(rows: readonly StockRowInput[]): readonly StockChange[] {
  return rows
    .filter((row) => row.next !== row.expected)
    .map((row) => ({
      variantId: row.variantId,
      expected: row.expected,
      next: row.next,
      note: row.note.trim() === "" ? null : row.note.trim(),
    }))
    .toSorted((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
}

export type LockedVariant = {
  readonly id: string;
  readonly stockQuantity: number;
  readonly archived: boolean;
};

export type MovedRow = {
  readonly variantId: string;
  // The current count, or null when the variant is gone.
  readonly now: number | null;
  readonly archived: boolean;
};

// Compare and set: every change whose variant moved since the page loaded (a sale, another
// admin), was archived meanwhile, or is gone. Any one of them refuses the whole save.
export function movedRows(
  changes: readonly StockChange[],
  locked: readonly LockedVariant[],
): readonly MovedRow[] {
  const byId = new Map(locked.map((variant) => [variant.id, variant]));
  return changes.flatMap((change): MovedRow[] => {
    const variant = byId.get(change.variantId);
    if (!variant) return [{ variantId: change.variantId, now: null, archived: true }];
    if (variant.archived || variant.stockQuantity !== change.expected) {
      return [
        { variantId: change.variantId, now: variant.stockQuantity, archived: variant.archived },
      ];
    }
    return [];
  });
}

// "+5", "-2": the change a history row shows.
export function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}
