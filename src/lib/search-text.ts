// Pure: the one text fold behind storefront search and the filter keys (spec 0013, AC-7, AC-13).
// Not `slugify`: it turns ł into a separator ("Kościół" → `koscio`), so letters that NFKD leaves
// whole are mapped by hand after the combining marks go.

const unsplitLetters: Readonly<Record<string, string>> = {
  ł: "l",
  ø: "o",
  đ: "d",
  ß: "ss",
  æ: "ae",
  œ: "oe",
};

const unsplitPattern = /[łøđßæœ]/g;

// Lowercase, accents removed, the letters above mapped. Search and filter keys both use it, so
// "Kościół", "KOSCIOL" and "kosciol" are one thing everywhere.
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(unsplitPattern, (letter) => unsplitLetters[letter] ?? letter);
}

// The folded words of a text, split on anything that is not a letter or digit.
export function searchWords(text: string): readonly string[] {
  return foldText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

// A filter key or value key: folded, each run of anything but letters and digits one `-`,
// trimmed. Empty when the text has no letter or digit; callers skip those.
export function facetKey(text: string): string {
  return foldText(text)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

// AC-7: every query word starts some word of the name.
export function matchesWords(nameWords: readonly string[], queryWords: readonly string[]): boolean {
  return queryWords.every((query) => nameWords.some((word) => word.startsWith(query)));
}
