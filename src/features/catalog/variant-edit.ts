import { combinationKey, combinations } from "./variant-grid";

// Pure rules of the Variants section (spec 0009, AC-7 to AC-9, AC-21).

export type VariantFields = {
  readonly price: number;
  readonly compareAt: number | null;
  readonly sku: string;
  readonly archived: boolean;
};

export type VariantRowEdit = {
  readonly variantId: string;
  readonly loaded: VariantFields;
} & VariantFields;

function sameFields(a: VariantFields, b: VariantFields): boolean {
  return (
    a.price === b.price &&
    a.compareAt === b.compareAt &&
    a.sku === b.sku &&
    a.archived === b.archived
  );
}

// Only rows the admin changed are saved, and only they are checked for conflicts: an edit to
// another row (or a sale, which never touches these fields) never refuses this save.
export function editedRows<R extends VariantRowEdit>(rows: readonly R[]): readonly R[] {
  return rows.filter((row) => !sameFields(row, row.loaded));
}

// AC-21: an edited row whose stored fields differ from what the page loaded, or that is gone.
export function variantsStale(
  edited: readonly VariantRowEdit[],
  current: ReadonlyMap<string, VariantFields>,
): boolean {
  return edited.some((row) => {
    const stored = current.get(row.variantId);
    return stored === undefined || !sameFields(stored, row.loaded);
  });
}

// AC-9: how many variants a customer could still pick once this save lands.
export function liveVariantCountAfter(
  current: ReadonlyMap<string, VariantFields>,
  edited: readonly VariantRowEdit[],
): number {
  const archivedAfter = new Map([...current].map(([id, fields]) => [id, fields.archived] as const));
  for (const row of edited) archivedAfter.set(row.variantId, row.archived);
  return [...archivedAfter.values()].filter((archived) => !archived).length;
}

export type NameEdit = {
  readonly id: string;
  readonly loaded: string;
  readonly next: string;
};

export type NameVerdict = "ok" | "stale" | "swap";

// AC-7 and AC-21 for option type names (within a product) or value names (within a type):
// a renamed entry whose stored name differs from the loaded one is stale; a new name equal to
// another entry's current name (a swap, or taking a name still in use) is refused, since the
// unique index would trip halfway through. Case insensitive, as on create.
export function renameVerdict(
  edits: readonly NameEdit[],
  current: ReadonlyMap<string, string>,
): NameVerdict {
  const renamed = edits.filter((edit) => edit.next !== edit.loaded);
  for (const edit of renamed) {
    if (current.get(edit.id) !== edit.loaded) return "stale";
  }
  for (const edit of renamed) {
    const taken = [...current].some(
      ([id, name]) => id !== edit.id && name.toLowerCase() === edit.next.toLowerCase(),
    );
    if (taken) return "swap";
  }
  return "ok";
}

// AC-8: the combinations a new value of option type `typeIndex` needs, as the other option
// types' value ids in option type order, in grid order. The new value goes last in its type,
// so every combination holding it is new and every existing row keeps its values.
export function newValueCombinations(
  typeValueIds: readonly (readonly string[])[],
  typeIndex: number,
): readonly (readonly string[])[] {
  const others = typeValueIds.filter((_, t) => t !== typeIndex);
  return combinations(others.map((values) => ({ name: "", values })));
}

// The new value's full combination: its id placed at its option type's index.
export function withNewValue(
  otherValueIds: readonly string[],
  typeIndex: number,
  newValueId: string,
): readonly string[] {
  return [...otherValueIds.slice(0, typeIndex), newValueId, ...otherValueIds.slice(typeIndex)];
}

// Whether the rows sent are exactly the combinations needed, each once.
export function sameCombinations(
  sent: readonly (readonly string[])[],
  needed: readonly (readonly string[])[],
): boolean {
  if (sent.length !== needed.length) return false;
  const neededKeys = new Set(needed.map(combinationKey));
  const sentKeys = new Set(sent.map(combinationKey));
  return sentKeys.size === sent.length && [...sentKeys].every((key) => neededKeys.has(key));
}
