// Pure rules for turning option types into variant rows (spec 0005, AC-2). The create form and
// the create action both use them, so the grid the admin sees is the grid that gets saved.

export const MAX_OPTION_TYPES = 3;
export const MAX_OPTION_VALUES = 10;
export const MAX_COMBINATIONS = 100;

export type OptionTypeInput = {
  readonly name: string;
  readonly values: readonly string[];
};

// Every combination, one value per option type, in option type order then value order.
// No option types gives exactly one combination: the default variant, with no values.
export function combinations(
  optionTypes: readonly OptionTypeInput[],
): readonly (readonly string[])[] {
  return optionTypes.reduce<readonly (readonly string[])[]>(
    (rows, type) => rows.flatMap((row) => type.values.map((value) => [...row, value])),
    [[]],
  );
}

export function combinationCount(optionTypes: readonly OptionTypeInput[]): number {
  return optionTypes.reduce((count, type) => count * type.values.length, 1);
}

// Keys a row by its values, so adding or removing one value leaves every other row (and what
// the admin typed in it) in place. Values cannot contain a newline (single line inputs).
export function combinationKey(values: readonly string[]): string {
  return values.join("\n");
}

// spec 0002: the variant's option value ids sorted ascending, joined with ","; "" when none.
export function optionKey(optionValueIds: readonly string[]): string {
  return [...optionValueIds].sort().join(",");
}

export const SKU_PATTERN = /^[A-Z0-9._-]{1,64}$/;

// The slug plus each value, uppercased, anything outside A-Z0-9 becoming "-".
export function suggestSku(slug: string, values: readonly string[]): string {
  return [slug, ...values]
    .join("-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}
