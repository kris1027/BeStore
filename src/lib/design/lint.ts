const palette =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const utilities =
  "bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|decoration|divide|shadow|accent|caret|placeholder";

// A raw palette class (`bg-neutral-900`, `hover:text-red-600/50`, `bg-white`) bypasses the
// tokens, so a rebrand would miss it.
const paletteClass = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*(?:${utilities})-(?:(?:${palette})-\\d{2,3}|black|white)(?:\\/\\d+)?(?![\\w-])`,
  "g",
);

// Light only until a dark mode spec exists.
const darkClass = /(?<![\w-])dark:[\w\-/[\]().:]+/g;

export type DesignViolation = { readonly line: number; readonly match: string };

// Pure: the caller decides which files to scan and which name is the store's.
export function findDesignViolations(source: string, storeName: string): DesignViolation[] {
  const escaped = storeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const name = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "g");
  return source
    .split("\n")
    .flatMap((text, index) =>
      [paletteClass, darkClass, name].flatMap((pattern) =>
        [...text.matchAll(pattern)].map((m) => ({ line: index + 1, match: m[0] })),
      ),
    );
}
