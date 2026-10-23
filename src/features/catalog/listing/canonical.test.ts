import { describe, expect, it } from "vitest";

import { listingCanonical, pagedTitle } from "./canonical";
import { PAGE_SIZE } from "./listing";
import { type ListingKind, parseListingParams, type RawParams } from "./params";

const path = "/categories/shoes";
// Three pages.
const total = PAGE_SIZE * 2 + 1;

function canonical(params: RawParams, kind: ListingKind = "category") {
  return listingCanonical(path, parseListingParams(params, kind, "EUR"), kind, total);
}

// spec 0018, AC-12 and AC-13.
describe("listingCanonical", () => {
  it.each([
    ["no params", {}],
    ["page 0", { page: "0" }],
    ["a page that is not a number", { page: "abc" }],
    ["page 1", { page: "1" }],
    ["the default sort", { sort: "featured" }],
    ["a toggle that is off", { stock: "0" }],
  ] as const)("gives the plain path for %s", (_label, params) => {
    expect(canonical(params)).toEqual({ path, page: 1 });
  });

  it("points an unfiltered page at itself", () => {
    expect(canonical({ page: "2" })).toEqual({ path: `${path}?page=2`, page: 2 });
  });

  it("names the page shown, so a page past the end is the last page", () => {
    expect(canonical({ page: "99" })).toEqual({ path: `${path}?page=3`, page: 3 });
  });

  it.each([
    ["an option filter", { color: "red", page: "2" }],
    ["a tracking param, which parses as an option filter", { utm_source: "x" }],
    ["another sort", { sort: "price-asc", page: "2" }],
    ["a price bound", { min: "10", page: "2" }],
    ["in stock", { stock: "1" }],
    ["on sale", { sale: "1", page: "2" }],
  ] as const)("gives the plain path for %s", (_label, params) => {
    expect(canonical(params)).toEqual({ path, page: 1 });
  });

  it("works on home the same way", () => {
    expect(
      listingCanonical("/", parseListingParams({ page: "2" }, "home", "EUR"), "home", total),
    ).toEqual({ path: "/?page=2", page: 2 });
  });

  it("gives page 1 for an empty scope", () => {
    expect(
      listingCanonical(path, parseListingParams({ page: "4" }, "category", "EUR"), "category", 0),
    ).toEqual({ path, page: 1 });
  });
});

describe("pagedTitle", () => {
  it("adds the page above 1 only", () => {
    expect(pagedTitle("Shoes", 1)).toBe("Shoes");
    expect(pagedTitle("Shoes", 2)).toBe("Shoes, page 2");
  });
});
