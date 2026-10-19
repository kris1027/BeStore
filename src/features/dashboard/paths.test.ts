import { describe, expect, it } from "vitest";

import { adminProductPath, paidOrdersPath } from "./paths";

describe("paidOrdersPath", () => {
  // covers: AC-13. Every order paid in the window, whatever its status now, so the list's rows
  // match the Orders card.
  it("lists all statuses by paid date over the window's first and last store day", () => {
    const url = new URL(
      paidOrdersPath({ firstDay: "2026-09-19", lastDay: "2026-10-18" }),
      "http://x",
    );
    expect(url.pathname).toBe("/admin/orders");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "all",
      dates: "paid",
      from: "2026-09-19",
      to: "2026-10-18",
    });
  });

  it("uses the same day for from and to on a one day window", () => {
    expect(paidOrdersPath({ firstDay: "2026-10-18", lastDay: "2026-10-18" })).toBe(
      "/admin/orders?status=all&dates=paid&from=2026-10-18&to=2026-10-18",
    );
  });
});

describe("adminProductPath", () => {
  // covers: AC-9
  it("links a best seller to its admin page", () => {
    expect(adminProductPath("8f0c2b1e-0000-4000-8000-000000000001")).toBe(
      "/admin/products/8f0c2b1e-0000-4000-8000-000000000001",
    );
  });
});
