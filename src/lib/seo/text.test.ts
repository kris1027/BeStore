import { describe, expect, it } from "vitest";

import { META_DESCRIPTION_MAX, plainExcerpt, presentText, textExcerpt } from "./text";

// spec 0018, AC-6.
describe("plainExcerpt", () => {
  it("drops the Markdown syntax and raw HTML, keeping link and emphasis text", () => {
    expect(plainExcerpt("## Soft\n\nA **warm** [wool](https://x.example) <b>scarf</b>.", 160)).toBe(
      "Soft A warm wool scarf.",
    );
  });

  it("keeps paragraphs, list items and hard breaks apart as words", () => {
    expect(plainExcerpt("One\n\nTwo\n\n- three\n- four\n\nfive  \nsix", 160)).toBe(
      "One Two three four five six",
    );
  });

  it("collapses whitespace", () => {
    expect(plainExcerpt("a   b\n\tc", 160)).toBe("a b c");
  });

  it("is null when nothing is left", () => {
    expect(plainExcerpt("", 160)).toBeNull();
    expect(plainExcerpt("<div></div>\n\n   ", 160)).toBeNull();
  });

  it("leaves text at the limit whole", () => {
    const text = "a".repeat(META_DESCRIPTION_MAX);
    expect(plainExcerpt(text, META_DESCRIPTION_MAX)).toBe(text);
  });

  it("cuts at the last word boundary and fits the ellipsis within the limit", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const cut = plainExcerpt(words, META_DESCRIPTION_MAX) ?? "";

    expect(Array.from(cut).length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(cut.endsWith("…")).toBe(true);
    expect(words.startsWith(cut.slice(0, -1))).toBe(true);
    expect(words[cut.length - 1]).toBe(" ");
  });

  it("hard cuts a single word longer than the limit", () => {
    expect(plainExcerpt("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("counts characters, never splitting a surrogate pair", () => {
    expect(plainExcerpt("😀".repeat(20), 10)).toBe(`${"😀".repeat(9)}…`);
  });
});

// spec 0018, AC-14: a category description is plain text on the page, so it keeps its symbols.
describe("textExcerpt", () => {
  it("keeps what Markdown would read as syntax", () => {
    expect(textExcerpt("# 1. Shoes *and* [boots](x)", 160)).toBe("# 1. Shoes *and* [boots](x)");
  });

  it("collapses whitespace and cuts by the AC-6 rule", () => {
    expect(textExcerpt("a   b\n\nc", 160)).toBe("a b c");
    expect(textExcerpt("one two three", 10)).toBe("one two…");
    expect(textExcerpt("  \n ", 160)).toBeNull();
  });
});

describe("presentText", () => {
  it("treats blank as unset", () => {
    expect(presentText(null)).toBeNull();
    expect(presentText("  ")).toBeNull();
    expect(presentText(" Shoes ")).toBe("Shoes");
  });
});
