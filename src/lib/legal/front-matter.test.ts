import { describe, expect, it } from "vitest";

import { normalizeText, parseFrontMatter } from "./front-matter";

const good =
  "---\ntitle: Terms of sale\ndescription: The rules.\nupdated: 2026-10-20\n---\n\nBody\n";

describe("parseFrontMatter", () => {
  it("reads the three keys and returns the body after the block", () => {
    expect(parseFrontMatter(good, "terms.md")).toEqual({
      meta: { title: "Terms of sale", description: "The rules.", updated: "2026-10-20" },
      body: "\nBody\n",
    });
  });

  it("keeps a colon inside a value", () => {
    const text = good.replace("The rules.", "Rules: orders and payment.");
    expect(parseFrontMatter(text, "terms.md").meta.description).toBe("Rules: orders and payment.");
  });

  it("parses a file saved with a BOM and CRLF line ends", () => {
    const windows = `﻿${good.replaceAll("\n", "\r\n")}`;
    expect(parseFrontMatter(windows, "terms.md").meta.updated).toBe("2026-10-20");
  });

  it.each([
    ["no block", "Body only"],
    ["a line that is not key: value", good.replace("title: Terms of sale", "Terms of sale")],
    ["a missing key", good.replace("description: The rules.\n", "")],
    ["an empty title", good.replace("title: Terms of sale", "title:")],
    ["a date that is not a real day", good.replace("2026-10-20", "2026-02-31")],
    ["a date in another format", good.replace("2026-10-20", "20.10.2026")],
  ])("throws on %s", (_, text) => {
    expect(() => parseFrontMatter(text, "terms.md")).toThrow("terms.md");
  });
});

describe("normalizeText", () => {
  it("drops a leading BOM and turns CRLF and CR into LF", () => {
    expect(normalizeText("﻿a\r\nb\rc")).toBe("a\nb\nc");
  });
});
