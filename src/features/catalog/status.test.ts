import { describe, expect, it } from "vitest";

import {
  canTransition,
  publishPosition,
  statusActions,
  statusActionTarget,
  type ProductStatus,
} from "./status";

// spec 0009, State transitions and AC-2, AC-3.

describe("canTransition", () => {
  it.each<[ProductStatus, ProductStatus, boolean]>([
    ["draft", "active", true],
    ["draft", "archived", true],
    ["active", "draft", true],
    ["active", "archived", true],
    ["archived", "draft", true],
    ["archived", "active", false],
    ["draft", "draft", false],
    ["active", "active", false],
    ["archived", "archived", false],
  ])("%s to %s is %s", (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });
});

describe("statusActions", () => {
  it("offers the buttons that apply to each status", () => {
    expect(statusActions("draft")).toEqual(["publish", "archive"]);
    expect(statusActions("active")).toEqual(["hide", "archive"]);
    expect(statusActions("archived")).toEqual(["restore"]);
  });

  it("restores to draft, never straight to active", () => {
    expect(statusActionTarget("restore")).toBe("draft");
    expect(statusActionTarget("hide")).toBe("draft");
    expect(statusActionTarget("publish")).toBe("active");
    expect(statusActionTarget("archive")).toBe("archived");
  });

  it("only offers transitions the table allows", () => {
    for (const from of ["draft", "active", "archived"] as const) {
      for (const action of statusActions(from)) {
        expect(canTransition(from, statusActionTarget(action))).toBe(true);
      }
    }
  });
});

describe("publishPosition", () => {
  it("is one below the lowest active position", () => {
    expect(publishPosition(3)).toBe(2);
    expect(publishPosition(-4)).toBe(-5);
  });

  it("is 0 when nothing is active", () => {
    expect(publishPosition(null)).toBe(0);
  });
});
