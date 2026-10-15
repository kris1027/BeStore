import { describe, expect, it } from "vitest";

import { isVisibleStatus, orderNumberParam, pageNumber } from "./order-view";

describe("isVisibleStatus (AC-11)", () => {
  it("shows only orders that were paid", () => {
    expect(isVisibleStatus("paid")).toBe(true);
    expect(isVisibleStatus("shipped")).toBe(true);
    expect(isVisibleStatus("delivered")).toBe(true);
    expect(isVisibleStatus("cancelled")).toBe(true);
    expect(isVisibleStatus("pending_payment")).toBe(false);
    expect(isVisibleStatus("expired")).toBe(false);
  });
});

describe("pageNumber", () => {
  it.each([
    ["2", 2],
    ["1", 1],
    ["0", 1],
    ["-3", 1],
    ["2.5", 1],
    ["abc", 1],
    [undefined, 1],
    [["2", "3"], 1],
    ["9999999", 1],
  ])("reads %j as page %i", (value, expected) => {
    expect(pageNumber(value)).toBe(expected);
  });
});

describe("orderNumberParam (AC-13)", () => {
  it.each([
    ["1042", 1042],
    ["2147483647", 2147483647],
    ["2147483648", null],
    ["0", null],
    ["01042", null],
    ["10e3", null],
    ["", null],
  ])("reads %j as %j", (value, expected) => {
    expect(orderNumberParam(value)).toBe(expected);
  });
});
