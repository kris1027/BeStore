import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

// Pure: Markdown to the plain text a meta description or JSON-LD carries (spec 0018, AC-6).

export const META_DESCRIPTION_MAX = 160;

// Containers whose children run together as one line of text; every other parent (lists, list
// items, quotes, the root) separates its children, so two paragraphs never fuse into one word.
const inline = new Set([
  "paragraph",
  "heading",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "tableCell",
]);

// The fields of an mdast node this walk reads.
type MdNode = { readonly type: string; readonly children?: readonly MdNode[] };

function plain(node: MdNode): string {
  // Raw HTML is skipped, as the description renderer skips it.
  if (node.type === "html") return "";
  if (node.type === "break") return " ";
  if (node.children) {
    return node.children.map(plain).join(inline.has(node.type) ? "" : " ");
  }
  // Text, code and an image's alt text.
  return toString(node, { includeHtml: false });
}

// The admin may leave a meta field blank; blank means unset.
export function presentText(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

// Whitespace collapsed, then cut at the last word boundary so the result with its "…" fits in
// `max` characters. null when nothing is left.
export function plainExcerpt(markdown: string, max: number): string | null {
  const text = plain(fromMarkdown(markdown)).replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (chars.length === 0) return null;
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1).join("");
  const boundary = head.lastIndexOf(" ");
  const cut = boundary > 0 ? head.slice(0, boundary) : head;
  return `${cut.trimEnd()}…`;
}
