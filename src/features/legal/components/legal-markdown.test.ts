import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { LegalMarkdown, legalUrl } = await import("./legal-markdown");

function render(markdown: string) {
  return renderToStaticMarkup(createElement(LegalMarkdown, { markdown }));
}

// spec 0017, Renderer.
describe("legalUrl", () => {
  it.each(["/returns", "#model-form", "https://uodo.gov.pl", "mailto:hi@example.com"])(
    "keeps %s",
    (url) => {
      expect(legalUrl(url)).toBe(url);
    },
  );

  it.each([
    "javascript:alert(1)",
    "http://example.com",
    "//evil.example",
    "data:text/html,x",
    "returns",
  ])("drops %s", (url) => {
    expect(legalUrl(url)).toBe("");
  });
});

describe("LegalMarkdown", () => {
  it("renders the allowed elements", () => {
    const html = render(
      "## Who we are\n\n### Contact\n\nPlain **bold** _em_\n\n- a\n\n1. b\n\n> quoted\n\n---",
    );
    for (const tag of [
      "<h2",
      "<h3",
      "<p",
      "<strong",
      "<em",
      "<ul",
      "<ol",
      "<li",
      "<blockquote",
      "<hr",
    ]) {
      expect(html).toContain(tag);
    }
  });

  it("never renders an h1, raw HTML or an image", () => {
    const html = render(
      "# Title\n\n<script>alert(1)</script><b>raw</b>\n\n![x](https://e.x/i.png)",
    );
    expect(html).not.toMatch(/<h1|<script|<b>|<img/);
    expect(html).toContain("Title");
  });

  it("links relative pages and marks external ones noopener noreferrer", () => {
    const html = render(
      "[returns](/returns) and [UODO](https://uodo.gov.pl) and [x](javascript:x)",
    );
    expect(html).toContain('href="/returns"');
    expect(html).toMatch(
      /href="https:\/\/uodo.gov.pl"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*href="https:\/\/uodo.gov.pl"/,
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<span>x</span>");
  });
});
