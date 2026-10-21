// Pure. The `{{name}}` placeholders in the legal texts (spec 0017, AC-4) and the
// `[[TO FILL: ...]]` markers a draft leaves for the store owner.

const placeholder = /\{\{\s*([A-Za-z][\w.]*)\s*\}\}/g;

// Every `{{name}}` is filled from `values`; one with no value throws, so `{{...}}` text never
// ships. Names in `keep` stay as they are, for a later fill (the live shipping values).
export function fillPlaceholders(
  text: string,
  values: Readonly<Record<string, string>>,
  keep: readonly string[] = [],
): string {
  return text.replace(placeholder, (whole, name: string) => {
    if (keep.includes(name)) return whole;
    const value = values[name];
    if (value === undefined) throw new Error(`Unknown legal placeholder {{${name}}}`);
    return value;
  });
}

export function placeholderNames(text: string): readonly string[] {
  return [...text.matchAll(placeholder)].map((match) => match[1] ?? "");
}

const fillMarkers = /\[\[TO FILL[^\]]*\]\]/g;

export function findFillMarkers(text: string): readonly string[] {
  return text.match(fillMarkers) ?? [];
}

export function toFillMarker(what: string): string {
  return `[[TO FILL: ${what}]]`;
}
