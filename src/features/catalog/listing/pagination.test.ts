import { describe, expect, it } from "vitest";

import { pageItems } from "./pagination";

const show = (current: number, count: number) =>
  pageItems(current, count)
    .map((item) => (item.kind === "gap" ? "…" : String(item.page)))
    .join(" ");

describe("pageItems (spec 0013, AC-5)", () => {
  it.each([
    [1, 1, "1"],
    [1, 2, "1 2"],
    [1, 3, "1 2 3"],
    [1, 10, "1 2 … 10"],
    [5, 10, "1 … 4 5 6 … 10"],
    [10, 10, "1 … 9 10"],
    [3, 10, "1 2 3 4 … 10"],
    [8, 10, "1 … 7 8 9 10"],
  ])("page %i of %i shows %s", (current, count, expected) => {
    expect(show(current, count)).toBe(expected);
  });
});
