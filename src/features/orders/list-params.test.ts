import { describe, expect, it } from "vitest";

import { adminOrdersHref, hasFilters, parseAdminOrdersParams, searchNumber } from "./list-params";

// spec 0010, AC-1 to AC-3: the /admin/orders filters in the URL.

const defaults = {
  q: "",
  status: "settled",
  attention: false,
  refund: null,
  from: null,
  to: null,
  before: null,
};

describe("parseAdminOrdersParams", () => {
  it("defaults to the settled orders with no filter", () => {
    expect(parseAdminOrdersParams({})).toEqual(defaults);
  });

  it("reads every filter", () => {
    expect(
      parseAdminOrdersParams({
        q: "  ada ",
        status: "shipped",
        attention: "1",
        refund: "partial",
        from: "2026-09-01",
        to: "2026-09-30",
        before: "1050",
      }),
    ).toEqual({
      q: "ada",
      status: "shipped",
      attention: true,
      refund: "partial",
      from: "2026-09-01",
      to: "2026-09-30",
      before: 1050,
    });
  });

  it("keeps the old ?view=all link working, and an explicit status wins", () => {
    expect(parseAdminOrdersParams({ view: "all" }).status).toBe("all");
    expect(parseAdminOrdersParams({ view: "all", status: "paid" }).status).toBe("paid");
  });

  it("ignores every invalid value instead of failing", () => {
    expect(
      parseAdminOrdersParams({
        status: "lost",
        attention: "yes",
        refund: "some",
        from: "2026-02-30",
        to: "tomorrow",
        before: "abc",
      }),
    ).toEqual(defaults);
  });

  it("drops both dates when from is after to", () => {
    const params = parseAdminOrdersParams({ from: "2026-10-02", to: "2026-10-01" });
    expect([params.from, params.to]).toEqual([null, null]);
  });

  it("cuts a long query to 100 characters and takes the first of repeated values", () => {
    expect(parseAdminOrdersParams({ q: "x".repeat(150) }).q).toHaveLength(100);
    expect(parseAdminOrdersParams({ status: ["paid", "shipped"] }).status).toBe("paid");
  });
});

describe("adminOrdersHref", () => {
  it("keeps every filter and the page, and drops defaults", () => {
    const params = parseAdminOrdersParams({ q: "50%", status: "all", attention: "1" });
    expect(adminOrdersHref(params, 1040)).toBe(
      "/admin/orders?q=50%25&status=all&attention=1&before=1040",
    );
    expect(adminOrdersHref(parseAdminOrdersParams({}))).toBe("/admin/orders");
  });

  it("says when a filter is set", () => {
    expect(hasFilters(parseAdminOrdersParams({}))).toBe(false);
    expect(hasFilters(parseAdminOrdersParams({ refund: "none" }))).toBe(true);
  });
});

describe("searchNumber", () => {
  it("matches an all digits query that fits an order number", () => {
    expect(searchNumber("1042")).toBe(1042);
    expect(searchNumber("2147483647")).toBe(2147483647);
    expect(searchNumber("2147483648")).toBeNull();
    expect(searchNumber("0")).toBeNull();
    expect(searchNumber("#1042")).toBeNull();
  });
});
