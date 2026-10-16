import { describe, expect, it } from "vitest";

import { buildIndexProduct } from "./index-rows";
import {
  buildListing,
  type Listing,
  type ListingProduct,
  type ListingScope,
  PAGE_SIZE,
} from "./listing";
import { parseListingParams } from "./params";

const image = { src: "/placeholder.svg", alt: "", width: null, height: null };

type Spec = {
  readonly name: string;
  readonly position?: number;
  readonly createdAt?: number;
  readonly categories?: Record<string, number>;
  // Option type name → values in admin order.
  readonly options?: Record<string, readonly string[]>;
  readonly variants?: readonly {
    readonly price?: number;
    readonly stock?: number;
    readonly compareAt?: number;
    // Option type name → value.
    readonly values?: Record<string, string>;
  }[];
};

let serial = 0;

// Through buildIndexProduct, so the fixtures have the index's real shape (merged keys, indexes).
function product(spec: Spec): ListingProduct {
  serial += 1;
  const id = `00000000-0000-7000-8000-${String(serial).padStart(12, "0")}`;
  const types = Object.entries(spec.options ?? {}).map(([name, values], t) => ({
    name,
    values: values.map((value, v) => ({ id: `${id}:${t}:${v}`, value })),
  }));
  const valueId = (typeName: string, value: string) => {
    const type = types.find((candidate) => candidate.name === typeName);
    return type?.values.find((candidate) => candidate.value === value)?.id ?? "missing";
  };
  return buildIndexProduct({
    id,
    name: spec.name,
    slug: spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    position: spec.position ?? 0,
    createdAt: new Date(spec.createdAt ?? 0),
    image,
    categories: Object.entries(spec.categories ?? {}).map(([categoryId, position]) => ({
      categoryId,
      position,
    })),
    optionTypes: types,
    variants: (spec.variants ?? [{}]).map((variant) => ({
      priceCents: variant.price ?? 1000,
      compareAtPriceCents: variant.compareAt ?? null,
      stockQuantity: variant.stock ?? 5,
      optionValues: Object.entries(variant.values ?? {}).map(([type, value]) => ({
        optionValueId: valueId(type, value),
      })),
    })),
  });
}

function list(
  index: readonly ListingProduct[],
  params: Record<string, string | string[]> = {},
  scope: ListingScope = { kind: "home" },
): Listing {
  const result = buildListing(index, scope, parseListingParams(params, scope.kind, "EUR"), "en");
  if (result.status !== "ok") throw new Error("expected a listing");
  return result;
}

const names = (listing: Listing) => listing.products.map((card) => card.name);

describe("order and scope (AC-1, AC-4)", () => {
  it("orders home by position, newest first, then id descending", () => {
    const index = [
      product({ name: "Old", position: 0, createdAt: 1 }),
      product({ name: "New", position: 0, createdAt: 2 }),
      product({ name: "Later", position: 1, createdAt: 3 }),
      product({ name: "Twin A", position: 2, createdAt: 4 }),
      product({ name: "Twin B", position: 2, createdAt: 4 }),
    ];

    expect(names(list(index))).toEqual(["New", "Old", "Later", "Twin B", "Twin A"]);
  });

  it("orders a category by its own positions first and lists only its products", () => {
    const index = [
      product({ name: "A", position: 0, categories: { linen: 2 } }),
      product({ name: "B", position: 1, categories: { linen: 0 } }),
      product({ name: "C", position: 2, categories: { wool: 0 } }),
      product({ name: "D", position: 3, categories: { linen: 0 }, createdAt: 9 }),
    ];

    const listing = list(index, {}, { kind: "category", categoryId: "linen" });

    // D and B tie in the category; products.position breaks it.
    expect(names(listing)).toEqual(["B", "D", "A"]);
    expect(listing.scopeTotal).toBe(3);
  });
});

describe("paging (AC-5, AC-18)", () => {
  const index = Array.from({ length: 50 }, (_, i) => product({ name: `P${i}`, position: i }));

  it("shows 24 a page", () => {
    const listing = list(index, { page: "2" });

    expect(PAGE_SIZE).toBe(24);
    expect(listing.pageCount).toBe(3);
    expect(names(listing)[0]).toBe("P24");
    expect(listing.products).toHaveLength(24);
  });

  it("renders the last page for a page past the end", () => {
    const listing = list(index, { page: "999" });

    expect(listing.page).toBe(3);
    expect(listing.state.page).toBe(3);
    expect(names(listing)).toEqual(["P48", "P49"]);
  });

  it("needs a second page from the 25th match on", () => {
    const at = (count: number) => list(index.slice(0, count));

    expect(at(24)).toMatchObject({ total: 24, pageCount: 1 });
    expect(at(25)).toMatchObject({ total: 25, pageCount: 2 });
  });

  it("has one page when nothing matches", () => {
    const listing = list(index, { min: "999" });

    expect(listing).toMatchObject({ total: 0, page: 1, pageCount: 1, scopeTotal: 50 });
  });
});

describe("search (AC-7 to AC-9)", () => {
  const index = [
    product({ name: "Kościół candle", position: 2 }),
    product({ name: "Blue Tee", position: 1 }),
    product({ name: "Settee", position: 0 }),
    product({ name: "Long Sleeve T Shirt", position: 0 }),
    product({ name: "T Shirt", position: 5 }),
  ];
  const search = (q: string, params: Record<string, string> = {}) =>
    buildListing(
      index,
      { kind: "search" },
      parseListingParams({ q, ...params }, "search", "EUR"),
      "en",
    );

  it("matches folded word prefixes of the name only", () => {
    const find = (q: string) => {
      const result = search(q);
      return result.status === "ok" ? names(result) : [];
    };

    expect(find("kosciol")).toEqual(["Kościół candle"]);
    expect(find("blu tee")).toEqual(["Blue Tee"]);
    expect(find("TEE")).toEqual(["Blue Tee"]);
    expect(find("zzz")).toEqual([]);
  });

  it("puts names that start with the query words first, ties in Featured order (AC-8)", () => {
    const result = search("t-shirt");

    expect(result.status === "ok" && names(result)).toEqual(["T Shirt", "Long Sleeve T Shirt"]);
  });

  it("prompts instead of searching a query under 2 characters or with no words", () => {
    expect(search("t")).toEqual({ status: "prompt" });
    expect(search("")).toEqual({ status: "prompt" });
    expect(search("!!")).toEqual({ status: "prompt" });
    expect(search(" a ")).toEqual({ status: "prompt" });
    expect(search("ab").status).toBe("ok");
  });

  it("prompts for a query of symbols or emoji only, whatever its length (AC-9)", () => {
    expect(search("😀😀")).toEqual({ status: "prompt" });
    expect(search("-- ** --")).toEqual({ status: "prompt" });
  });

  it("can still sort a search by another key", () => {
    const result = search("shirt", { sort: "name" });

    expect(result.status === "ok" && names(result)).toEqual(["Long Sleeve T Shirt", "T Shirt"]);
  });
});

describe("per variant filters (AC-12)", () => {
  const options = { Color: ["Red", "Blue"], Size: ["S", "M"] };
  const mixed = product({
    name: "Mixed",
    options,
    variants: [
      { values: { Color: "Red", Size: "S" }, stock: 0, price: 1000 },
      { values: { Color: "Blue", Size: "M" }, price: 3000 },
    ],
  });
  const plain = product({ name: "Plain", position: 1 });
  const index = [mixed, plain];

  it("needs one variant to satisfy every option filter together", () => {
    expect(names(list(index, { color: "red", size: "m" }))).toEqual([]);
    expect(names(list(index, { color: "red", size: "s" }))).toEqual(["Mixed"]);
    expect(names(list(index, { color: ["red", "blue"], size: "m" }))).toEqual(["Mixed"]);
  });

  it("drops a product whose only matching variant is sold out with In stock only", () => {
    expect(names(list(index, { color: "red", stock: "1" }))).toEqual([]);
    expect(names(list(index, { color: "blue", stock: "1" }))).toEqual(["Mixed"]);
  });

  it("never matches an option filter on a product without that option", () => {
    expect(names(list(index, { color: "blue" }))).toEqual(["Mixed"]);
  });

  it("filters price on the same variant, inclusive", () => {
    expect(names(list(index, { color: "red", min: "20" }))).toEqual([]);
    expect(names(list(index, { min: "10", max: "10" }))).toEqual(["Mixed", "Plain"]);
    expect(names(list(index, { min: "30" }))).toEqual(["Mixed"]);
  });

  it("counts sale only on an in stock variant with a compare at price", () => {
    const sale = product({
      name: "Sale",
      variants: [{ compareAt: 2000, stock: 0 }, { stock: 3 }],
    });
    const realSale = product({ name: "Real sale", variants: [{ compareAt: 2000, stock: 1 }] });

    expect(names(list([sale, realSale], { sale: "1" }))).toEqual(["Real sale"]);
  });
});

describe("option groups (AC-13)", () => {
  it("merges spellings, labels with the most common, and orders groups and values", () => {
    const index = [
      product({ name: "A", position: 0, options: { Colour: ["Red", "Green"], Size: ["M", "S"] } }),
      product({ name: "B", position: 1, options: { "colour ": ["red", "Blue"] } }),
      product({ name: "C", position: 2, options: { COLOUR: ["RED", "Blue"], Fit: ["Slim"] } }),
    ];

    const { groups } = list(index);

    expect(groups.map((group) => [group.label, group.values.map((value) => value.label)])).toEqual([
      ["Colour", ["Red", "Green", "Blue"]],
      ["Size", ["M", "S"]],
    ]);
    // Fit has one value only, so it is not offered.
    expect(groups.find((group) => group.key === "fit")).toBeUndefined();
  });

  it("merges two types with one key inside a product and counts a value once per variant", () => {
    const twice = product({
      name: "Twice",
      options: { Color: ["Red", "Blue"], color: ["red"] },
      variants: [{ values: { Color: "Red", color: "red" } }, { values: { Color: "Blue" } }],
    });

    const listing = list([twice]);

    expect(twice.optionTypes).toHaveLength(1);
    expect(listing.groups[0]?.values.map((value) => [value.key, value.count])).toEqual([
      ["red", 1],
      ["blue", 1],
    ]);
  });

  it("skips empty keys and never offers a group named like a reserved param", () => {
    const index = [
      product({
        name: "A",
        options: { Sort: ["Up", "Down"], "!!": ["X", "Y"], Size: ["—", "S", "M"] },
      }),
    ];

    const { groups } = list(index);

    expect(groups.map((group) => group.key)).toEqual(["size"]);
    expect(groups[0]?.values.map((value) => value.key)).toEqual(["s", "m"]);
  });

  it("labels a tied spelling by the first one in Featured order", () => {
    const first = product({ name: "A", position: 0, options: { COLOR: ["Red", "Blue"] } });
    const second = product({ name: "B", position: 1, options: { Color: ["red", "blue"] } });

    expect(list([first, second]).groups[0]).toMatchObject({ label: "COLOR" });
    expect(
      list([
        { ...first, position: 1 },
        { ...second, position: 0 },
      ]).groups[0],
    ).toMatchObject({ label: "Color" });
  });

  it("orders groups used by as many products by label", () => {
    const { groups } = list([
      product({ name: "A", options: { Size: ["S", "M"], Fit: ["Slim", "Wide"] } }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["Fit", "Size"]);
  });

  it("keeps a Cyrillic option a key of its own", () => {
    const { groups } = list([product({ name: "A", options: { Цвет: ["Красный", "Синий"] } })]);

    expect(groups[0]).toMatchObject({ key: "цвет", label: "Цвет" });
  });

  it("ignores unknown groups and values in the URL, and the state says so", () => {
    const index = [product({ name: "A", options: { Color: ["Red", "Blue"] } })];

    const listing = list(index, { color: ["red", "nope"], fabric: "silk" });

    expect(listing.state.options).toEqual([{ key: "color", values: ["red"] }]);
    expect(listing.activeFilters).toBe(1);
  });
});

describe("counts (AC-14)", () => {
  const options = { Color: ["Red", "Blue"], Size: ["S", "M"] };
  const index = [
    product({
      name: "Red S",
      options,
      variants: [{ values: { Color: "Red", Size: "S" } }],
    }),
    product({
      name: "Red M and Blue M",
      options,
      variants: [
        { values: { Color: "Red", Size: "M" } },
        { values: { Color: "Blue", Size: "M" }, stock: 0 },
      ],
    }),
  ];
  const counts = (listing: Listing, key: string) =>
    Object.fromEntries(
      listing.groups
        .find((group) => group.key === key)
        ?.values.map((value) => [value.key, [value.count, value.selected]]) ?? [],
    );

  it("ignores the group's own selection and applies every other filter", () => {
    const listing = list(index, { color: "red", size: "m" });

    expect(counts(listing, "color")).toEqual({ red: [1, true], blue: [1, false] });
    expect(counts(listing, "size")).toEqual({ s: [1, false], m: [1, true] });
  });

  it("gives zero for a value nothing would match, and counts products not variants", () => {
    const listing = list(index, { size: "s" });

    expect(counts(listing, "color")).toEqual({ red: [1, false], blue: [0, false] });
    expect(counts(list(index), "color")).toEqual({ red: [2, false], blue: [1, false] });
  });

  it("counts each toggle with it on and every other filter applied", () => {
    const listing = list(index, { color: "blue" });

    expect(listing.inStockCount).toBe(0);
    expect(list(index).inStockCount).toBe(2);
    expect(list(index).onSaleCount).toBe(0);
  });
});

describe("the scope behind filters and counts (AC-3, AC-11, AC-13)", () => {
  const options = { Color: ["Red", "Blue"] };
  const inCategory = product({
    name: "Linen Tee",
    categories: { c: 0 },
    options,
    variants: [
      { price: 2000, values: { Color: "Red" } },
      { price: 4000, values: { Color: "Blue" } },
    ],
  });
  const elsewhere = product({
    name: "Wool Coat",
    position: 1,
    options: { Size: ["S", "M"] },
    variants: [
      { price: 90000, values: { Size: "S" } },
      { price: 95000, values: { Size: "M" } },
    ],
  });
  const index = [inCategory, elsewhere];

  it("offers a category only the groups and prices of its own products", () => {
    const listing = list(index, {}, { kind: "category", categoryId: "c" });

    expect(listing.groups.map((group) => group.key)).toEqual(["color"]);
    expect(listing.priceBounds).toEqual({ minCents: 2000, maxCents: 4000 });
  });

  it("offers a search only the groups and prices of what it found", () => {
    const result = buildListing(
      index,
      { kind: "search" },
      parseListingParams({ q: "coat" }, "search", "EUR"),
      "en",
    );

    expect(result.status === "ok" && result.groups.map((group) => group.key)).toEqual(["size"]);
    expect(result.status === "ok" && result.priceBounds).toEqual({
      minCents: 90000,
      maxCents: 95000,
    });
  });

  it("keeps every group when the filters leave nothing", () => {
    const listing = list(index, { min: "999999" });

    expect(listing.total).toBe(0);
    expect(listing.groups.map((group) => group.key)).toEqual(["color", "size"]);
    expect(listing.priceBounds).toEqual({ minCents: 2000, maxCents: 95000 });
  });

  it("gives an empty category no groups, no prices and one page", () => {
    const listing = list(index, {}, { kind: "category", categoryId: "empty" });

    expect(listing).toMatchObject({
      total: 0,
      scopeTotal: 0,
      page: 1,
      pageCount: 1,
      groups: [],
      priceBounds: null,
    });
  });
});

describe("price bounds (AC-15)", () => {
  it("are the lowest and highest variant price of the scope before filters", () => {
    const index = [
      product({ name: "A", variants: [{ price: 500 }, { price: 9000 }] }),
      product({ name: "B", variants: [{ price: 1200 }] }),
    ];

    expect(list(index, { min: "50" }).priceBounds).toEqual({ minCents: 500, maxCents: 9000 });
    expect(list([index[1] as ListingProduct]).priceBounds).toEqual({
      minCents: 1200,
      maxCents: 1200,
    });
  });
});

describe("sorts (AC-16)", () => {
  const index = [
    product({ name: "banana", position: 0, createdAt: 1, variants: [{ price: 3000 }] }),
    product({
      name: "Apple",
      position: 1,
      createdAt: 3,
      variants: [{ price: 900 }, { price: 9000 }],
    }),
    product({ name: "cherry", position: 2, createdAt: 2, variants: [{ price: 3000 }] }),
  ];

  it.each([
    ["featured", ["banana", "Apple", "cherry"]],
    ["newest", ["Apple", "cherry", "banana"]],
    // By the lowest variant price; the 3000 tie keeps Featured order.
    ["price-asc", ["Apple", "banana", "cherry"]],
    ["price-desc", ["banana", "cherry", "Apple"]],
    // Locale collation, not code points: "Apple" before "banana".
    ["name", ["Apple", "banana", "cherry"]],
  ])("sorts by %s", (sort, expected) => {
    expect(names(list(index, { sort }))).toEqual(expected);
  });

  it("sorts names by the store locale's collation", () => {
    const polish = [
      product({ name: "Mama", position: 0 }),
      product({ name: "Łódź", position: 1 }),
      product({ name: "Lato", position: 2 }),
    ];
    const state = parseListingParams({ sort: "name" }, "home", "PLN");

    const result = buildListing(polish, { kind: "home" }, state, "pl-PL");

    // Code points would put Ł after M; Polish puts it right after L.
    expect(result.status === "ok" && names(result)).toEqual(["Lato", "Łódź", "Mama"]);
  });

  it("keeps the category's own order for ties", () => {
    const tied = [
      product({ name: "X", position: 0, categories: { c: 1 }, variants: [{ price: 100 }] }),
      product({ name: "Y", position: 1, categories: { c: 0 }, variants: [{ price: 100 }] }),
    ];

    expect(names(list(tied, { sort: "price-asc" }, { kind: "category", categoryId: "c" }))).toEqual(
      ["Y", "X"],
    );
  });
});

describe("cards", () => {
  it("carry the from price, sold out and sale from the variants", () => {
    const index = [
      product({ name: "Gone", variants: [{ stock: 0, compareAt: 5000 }] }),
      product({
        name: "Range",
        position: 1,
        variants: [{ price: 1000, compareAt: 2000 }, { price: 1500 }],
      }),
    ];

    expect(
      list(index).products.map(({ name, minPriceCents, maxPriceCents, soldOut, onSale }) => ({
        name,
        minPriceCents,
        maxPriceCents,
        soldOut,
        onSale,
      })),
    ).toEqual([
      { name: "Gone", minPriceCents: 1000, maxPriceCents: 1000, soldOut: true, onSale: false },
      { name: "Range", minPriceCents: 1000, maxPriceCents: 1500, soldOut: false, onSale: true },
    ]);
  });
});
