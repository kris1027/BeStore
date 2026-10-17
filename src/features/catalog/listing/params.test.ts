import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  clearedFilters,
  listingHref,
  type ListingState,
  parseListingParams,
  toggleOption,
  withPrices,
} from "./params";

const parse = (params: Record<string, string | string[]>, kind: "home" | "search" = "home") =>
  parseListingParams(params, kind, "EUR");

const base = parse({});

describe("parseListingParams (spec 0013, AC-17, AC-18)", () => {
  it("defaults to page 1, the kind's default sort and no filters", () => {
    expect(base).toEqual({
      q: "",
      sort: "featured",
      page: 1,
      minCents: null,
      maxCents: null,
      inStock: false,
      onSale: false,
      options: [],
    });
    expect(parse({}, "search").sort).toBe("relevance");
  });

  it("reads every param", () => {
    expect(
      parse(
        {
          q: "  linen tee ",
          sort: "price-asc",
          page: "3",
          min: "10",
          max: "49.99",
          stock: "1",
          sale: "1",
          size: ["m", "s"],
          color: "red",
        },
        "search",
      ),
    ).toEqual({
      q: "linen tee",
      sort: "price-asc",
      page: 3,
      minCents: 1000,
      maxCents: 4999,
      inStock: true,
      onSale: true,
      options: [
        { key: "color", values: ["red"] },
        { key: "size", values: ["m", "s"] },
      ],
    });
  });

  it("swaps min above max and accepts 0", () => {
    expect(parse({ min: "50", max: "10" })).toMatchObject({ minCents: 1000, maxCents: 5000 });
    expect(parse({ min: "0" }).minCents).toBe(0);
  });

  it("drops an unparsable or negative price", () => {
    expect(parse({ min: "-5", max: "abc" })).toMatchObject({ minCents: null, maxCents: null });
    expect(parse({ min: "1.999" }).minCents).toBeNull();
  });

  it("reads a price in the store currency's own minor units", () => {
    expect(parse({ min: "9.5" }).minCents).toBe(950);
    // JPY has no minor units, so a fraction is not a price and the bound is dropped.
    expect(parseListingParams({ min: "9.5", max: "950" }, "home", "JPY")).toMatchObject({
      minCents: null,
      maxCents: 950,
    });
  });

  it("ignores an unknown sort, and relevance outside search", () => {
    expect(parse({ sort: "zzz" }).sort).toBe("featured");
    expect(parse({ sort: "relevance" }).sort).toBe("featured");
    expect(parse({ sort: "relevance" }, "search").sort).toBe("relevance");
  });

  it("keeps the first value of a repeated scalar param", () => {
    expect(
      parse({ sort: ["newest", "name"], page: ["2", "5"], q: ["a b", "c"] }, "search"),
    ).toMatchObject({
      sort: "newest",
      page: 2,
      q: "a b",
    });
  });

  it("reads a non numeric or zero page as 1 and keeps a huge one for clamping", () => {
    expect(parse({ page: "two" }).page).toBe(1);
    expect(parse({ page: "0" }).page).toBe(1);
    expect(parse({ page: "-2" }).page).toBe(1);
    expect(parse({ page: "999999999999999999999" }).page).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("only reads q on search, trimmed and capped at 100 whole characters", () => {
    expect(parse({ q: "tee" }).q).toBe("");
    const emoji = "😀".repeat(120);
    const q = parse({ q: ` ${emoji} ` }, "search").q;
    expect(Array.from(q)).toHaveLength(100);
    expect(q).toBe("😀".repeat(100));
  });

  it("folds option keys and values, dedupes and never reads a reserved key as a group", () => {
    expect(parse({ Colour: ["Red", "red", "RED", "!!"], "": "x", stock: "yes" }).options).toEqual([
      { key: "colour", values: ["red"] },
    ]);
  });

  it("reads at most 20 values per group, and leaves the group cap to buildListing", () => {
    const params = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `g${i}`,
        Array.from({ length: 25 }, (_, j) => `v${j}`),
      ]),
    );
    const { options } = parse(params);

    expect(options).toHaveLength(12);
    expect(options.every((group) => group.values.length === 20)).toBe(true);
  });
});

describe("listingHref", () => {
  it("leaves out every default, so the plain state is the plain path", () => {
    expect(listingHref("/", base, "home", "EUR")).toBe("/");
    expect(listingHref("/search", { ...parse({}, "search"), q: "tee" }, "search", "EUR")).toBe(
      "/search?q=tee",
    );
  });

  it("writes params in one stable order whatever order they came in", () => {
    const a = parse({ color: ["red", "blue"], page: "2", stock: "1", min: "10", size: "m" });
    const b = parse({ size: "m", min: "10.00", stock: "1", page: "2", color: ["blue", "red"] });

    expect(listingHref("/", a, "home", "EUR")).toBe(
      "/?min=10&stock=1&color=blue&color=red&size=m&page=2",
    );
    expect(listingHref("/", b, "home", "EUR")).toBe(listingHref("/", a, "home", "EUR"));
  });

  it("keeps a price fraction and round trips through the parser", () => {
    const state = parse({ min: "9.5", max: "20", sort: "name", sale: "1" });
    const href = listingHref("/categories/linen", state, "category", "EUR");

    expect(href).toBe("/categories/linen?sort=name&min=9.50&max=20&sale=1");
    const reparsed = parseListingParams(
      Object.fromEntries(new URL(href, "https://shop.example").searchParams),
      "category",
      "EUR",
    );
    expect(reparsed).toEqual(state);
  });

  it("keeps a query with spaces, symbols and accents as one q param", () => {
    const state = parse({ q: "a&b = 50% łódź" }, "search");
    const href = listingHref("/search", state, "search", "EUR");

    const reparsed = parseListingParams(
      Object.fromEntries(new URL(href, "https://shop.example").searchParams),
      "search",
      "EUR",
    );
    expect(reparsed.q).toBe("a&b = 50% łódź");
  });

  it("writes a currency without minor units as whole numbers", () => {
    const state = parseListingParams({ min: "500", max: "1200" }, "home", "JPY");

    expect(state).toMatchObject({ minCents: 500, maxCents: 1200 });
    expect(listingHref("/", state, "home", "JPY")).toBe("/?min=500&max=1200");
  });

  it("never writes relevance off search, or q off search", () => {
    const state: ListingState = { ...base, q: "tee", sort: "featured" };
    expect(listingHref("/", state, "home", "EUR")).toBe("/");
  });
});

describe("state changes", () => {
  const paged = parse({ page: "4", q: "tee", color: "red", stock: "1" }, "search");

  it("starts again at page 1 on any filter or sort change (AC-17)", () => {
    expect(toggleOption(paged, "size", "m").page).toBe(1);
    expect(withPrices(paged, "5", "", "EUR").page).toBe(1);
  });

  it("toggles a value in and out of its group, dropping an empty group", () => {
    const on = toggleOption(paged, "color", "blue");
    expect(on.options).toEqual([{ key: "color", values: ["blue", "red"] }]);
    expect(toggleOption(toggleOption(on, "color", "blue"), "color", "red").options).toEqual([]);
  });

  it("repairs typed prices like the parser: swapped, dropped, fractions", () => {
    expect(withPrices(base, "50", "10", "EUR")).toMatchObject({ minCents: 1000, maxCents: 5000 });
    expect(withPrices(base, "abc", "12.5", "EUR")).toMatchObject({
      minCents: null,
      maxCents: 1250,
    });
    expect(withPrices(base, "500", "", "JPY")).toMatchObject({ minCents: 500, maxCents: null });
  });

  it("clears every filter but keeps q and the sort (AC-20, AC-21)", () => {
    const sorted = { ...paged, sort: "newest" as const, minCents: 100 };
    expect(clearedFilters(sorted)).toEqual({ ...base, q: "tee", sort: "newest" });
  });

  it("counts one per value, per price bound and per toggle (AC-20)", () => {
    expect(activeFilterCount(base)).toBe(0);
    expect(
      activeFilterCount(
        parse({ color: ["red", "blue"], size: "m", min: "1", max: "2", stock: "1", sale: "1" }),
      ),
    ).toBe(7);
  });
});
