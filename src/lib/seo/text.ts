import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

// Pure: Markdown to the plain text a meta description or JSON-LD carries (spec 0018, AC-6).

export const META_DESCRIPTION_MAX = 160;

// Containers whose children run together as one line of text; every other parent (lists, list
// items, quotes, the root) separates its children, so two paragraphs never fuse into one word.
const inlineContainers = new Set([
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

function plainText(node: MdNode): string {
  // Raw HTML is skipped, as the description renderer skips it.
  if (node.type === "html") return "";
  if (node.type === "break") return " ";
  if (node.children) {
    return node.children.map(plainText).join(inlineContainers.has(node.type) ? "" : " ");
  }
  // Text, code and an image's alt text.
  return toString(node, { includeHtml: false });
}

// The admin may leave a meta field blank; blank means unset.
export function presentText(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

// Plain text with whitespace collapsed, then cut at the last word boundary so the result with
// its "…" fits in `max` characters. null when nothing is left. For text the page shows as is (a
// category description): a Markdown parse would drop characters the page keeps.
export function textExcerpt(text: string, max: number): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(collapsed);
  if (chars.length === 0) return null;
  if (chars.length <= max) return collapsed;
  const head = chars.slice(0, max - 1).join("");
  const boundary = head.lastIndexOf(" ");
  const cut = boundary > 0 ? head.slice(0, boundary) : head;
  return `${cut.trimEnd()}…`;
}

// textExcerpt of the Markdown's plain text (a product description, which the page renders).
export function plainExcerpt(markdown: string, max: number): string | null {
  return textExcerpt(plainText(fromMarkdown(markdown)), max);
}
