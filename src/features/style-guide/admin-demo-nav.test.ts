import { describe, expect, it } from "vitest";

import { generateStaticParams } from "../../../app/style-guide/admin/[section]/page";

import { demoNav, demoSections } from "./admin-demo-nav";

// Every demo link needs a page, or each production prefetch logs a 404 (commit 86f9979).
describe("admin demo nav", () => {
  it("derives one section per link below the dashboard", () => {
    expect(demoSections).toEqual(["orders", "products", "discounts"]);
  });

  it("gives every nav link a page behind it", () => {
    const pages = [
      "/style-guide/admin",
      ...generateStaticParams().map(({ section }) => `/style-guide/admin/${section}`),
    ];

    expect(pages.toSorted()).toEqual(demoNav.map((item) => item.href).toSorted());
  });
});
