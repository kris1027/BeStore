// Pure: which page links a listing shows (spec 0013, AC-5): first, last, the current page ±1,
// and a gap wherever pages are skipped.

export type PageItem = { readonly kind: "page"; readonly page: number } | { readonly kind: "gap" };

export function pageItems(current: number, pageCount: number): readonly PageItem[] {
  const pages = [...new Set([1, current - 1, current, current + 1, pageCount])]
    .filter((page) => page >= 1 && page <= pageCount)
    .toSorted((a, b) => a - b);
  return pages.flatMap((page, index): PageItem[] => {
    const previous = pages[index - 1];
    const item: PageItem = { kind: "page", page };
    return previous !== undefined && page - previous > 1 ? [{ kind: "gap" }, item] : [item];
  });
}
