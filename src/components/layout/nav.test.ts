import { describe, expect, it } from "vitest";

import { currentHref, matchesPath } from "./nav";

describe("matchesPath", () => {
  it.each([
    ["/admin/orders", "/admin/orders", true],
    ["/admin/orders", "/admin/orders/123", true],
    ["/admin/orders", "/admin/orders-archive", false],
    ["/admin/orders", "/admin", false],
    ["/admin", "/admin/orders", true],
    ["/", "/", true],
    ["/", "/products", false],
  ])("href %s on %s is %s", (href, pathname, expected) => {
    expect(matchesPath(href, pathname)).toBe(expected);
  });
});

describe("currentHref", () => {
  const items = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/orders", label: "Orders" },
    { href: "/admin/products", label: "Products" },
  ];

  it("picks the most specific match", () => {
    expect(currentHref(items, "/admin/orders/123")).toBe("/admin/orders");
  });

  it("marks the parent on its own page", () => {
    expect(currentHref(items, "/admin")).toBe("/admin");
  });

  it("marks nothing outside the list", () => {
    expect(currentHref(items, "/style-guide")).toBeUndefined();
  });

  it("marks nothing in an empty list", () => {
    expect(currentHref([], "/admin")).toBeUndefined();
  });
});
