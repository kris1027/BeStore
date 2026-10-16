import { describe, expect, it } from "vitest";

import { facetKey, foldText, matchesWords, searchWords } from "./search-text";

describe("foldText", () => {
  it.each([
    ["Kościół", "kosciol"],
    ["ŁÓDŹ", "lodz"],
    ["Øre", "ore"],
    ["Đorđe", "dorde"],
    ["Straße", "strasse"],
    ["Æble", "aeble"],
    ["Cœur", "coeur"],
    ["Crème Brûlée", "creme brulee"],
    // A precomposed letter and a letter plus a combining mark fold the same way.
    ["é", "e"],
    ["İstanbul", "istanbul"],
  ])("folds %s to %s", (text, folded) => {
    expect(foldText(text)).toBe(folded);
  });
});

describe("searchWords", () => {
  it("splits on anything that is not a letter or digit", () => {
    expect(searchWords("T-Shirt, 2-pack!")).toEqual(["t", "shirt", "2", "pack"]);
    expect(searchWords("  ")).toEqual([]);
    expect(searchWords("!!")).toEqual([]);
  });

  it("keeps letters of other scripts", () => {
    expect(searchWords("Футболка Синяя")).toEqual(["футболка", "синяя"]);
  });
});

describe("facetKey", () => {
  it("merges spellings of one option name or value", () => {
    expect(facetKey("Colour")).toBe("colour");
    expect(facetKey("colour ")).toBe("colour");
    expect(facetKey("COLOUR")).toBe("colour");
    expect(facetKey("Navy  Blue")).toBe("navy-blue");
    expect(facetKey("--Extra / Large--")).toBe("extra-large");
  });

  it("keeps a key for Cyrillic names and is empty without letters or digits", () => {
    expect(facetKey("Цвет")).toBe("цвет");
    expect(facetKey("—")).toBe("");
    expect(facetKey("")).toBe("");
  });
});

describe("matchesWords (spec 0013, AC-7)", () => {
  const name = (text: string) => searchWords(text);

  it.each([
    ["kosciol", "Kościół", true],
    ["blu tee", "Blue Tee", true],
    ["TEE", "Tee", true],
    ["tee", "Settee", false],
    ["tee blue", "Blue Tee", true],
    ["blue shirt", "Blue Tee", false],
  ])("%s against %s is %s", (query, product, expected) => {
    expect(matchesWords(name(product), searchWords(query))).toBe(expected);
  });
});
