import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { descriptionUrl, ProductDescription } from "./markdown";

// spec 0009, AC-6: what a description may render, and everything it may not.

const render = (markdown: string) =>
  renderToStaticMarkup(createElement(ProductDescription, { markdown }));

describe("ProductDescription", () => {
  it("renders paragraphs, emphasis, lists and level 2 and 3 headings", () => {
    const html = render(
      "Soft **linen**, *washed*.\n\n- One\n- Two\n\n1. First\n\n## Care\n\n### Washing",
    );
    expect(html).toContain("<strong");
    expect(html).toContain("<em>washed</em>");
    expect(html).toMatch(/<ul[^>]*>\s*<li>One<\/li>/);
    expect(html).toMatch(/<ol[^>]*>\s*<li>First<\/li>/);
    expect(html).toMatch(/<h2[^>]*>Care<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>Washing<\/h3>/);
  });

  it("renders a # heading as h2 and deeper ones as h3, never an h1", () => {
    const html = render("# Big\n\n#### Small");
    expect(html).not.toContain("<h1");
    expect(html).toMatch(/<h2[^>]*>Big<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>Small<\/h3>/);
  });

  it("keeps line breaks", () => {
    expect(render("One  \nTwo")).toContain("<br/>");
  });

  it("never renders raw HTML or scripts", () => {
    const html = render(
      '<script>alert(1)</script>\n\nHi <b onclick="x()">there</b>\n\n<img src=x onerror=alert(1)>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<img");
    expect(html).toContain("there");
  });

  it("drops Markdown images", () => {
    const html = render("![a cat](https://example.com/cat.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("cat.png");
  });

  it("links http, https and mailto with nofollow in the same tab, and nothing else", () => {
    const html = render(
      "[a](https://example.com) [b](http://example.com) [c](mailto:hi@example.com) [d](javascript:alert(1)) [e](/relative) [f](data:text/html,x)",
    );
    expect(html).toContain('<a href="https://example.com" rel="nofollow"');
    expect(html).toContain('<a href="http://example.com" rel="nofollow"');
    expect(html).toContain('<a href="mailto:hi@example.com" rel="nofollow"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('href="/relative"');
    expect(html).not.toContain("data:");
    expect(html).not.toContain("target=");
    expect(html).toContain("<span>d</span>");
  });
});

describe("descriptionUrl", () => {
  it("keeps only absolute http, https and mailto URLs", () => {
    expect(descriptionUrl(" https://example.com/a ")).toBe("https://example.com/a");
    expect(descriptionUrl("MAILTO:a@b.c")).toBe("MAILTO:a@b.c");
    expect(descriptionUrl("javascript:alert(1)")).toBe("");
    expect(descriptionUrl("//evil.example")).toBe("");
    expect(descriptionUrl("#top")).toBe("");
  });
});
