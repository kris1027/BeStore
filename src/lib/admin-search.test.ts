import { describe, expect, it } from "vitest";

import { SEARCH_MAX_LENGTH, parseSearchQuery } from "./admin-search";

describe("parseSearchQuery", () => {
  it("trims the query", () => {
    expect(parseSearchQuery({ q: "  shirt  " })).toBe("shirt");
  });

  it("is empty when q is missing", () => {
    expect(parseSearchQuery({})).toBe("");
  });

  it("is empty when q is not a string", () => {
    expect(parseSearchQuery({ q: 42 })).toBe("");
    expect(parseSearchQuery({ q: undefined })).toBe("");
  });

  it("takes the first value of a repeated param", () => {
    expect(parseSearchQuery({ q: ["a", "b"] })).toBe("a");
    expect(parseSearchQuery({ q: [" a ", "b"] })).toBe("a");
  });

  it("is empty for an empty repeated param", () => {
    expect(parseSearchQuery({ q: [] })).toBe("");
  });

  it("caps the trimmed query at the max length", () => {
    const q = parseSearchQuery({ q: ` ${"a".repeat(SEARCH_MAX_LENGTH + 50)} ` });
    expect(q).toBe("a".repeat(SEARCH_MAX_LENGTH));
  });
});
