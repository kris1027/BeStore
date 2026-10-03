import { describe, expect, it } from "vitest";

import { moveId, sortableAnnouncements } from "./sortable";

// spec 0009, AC-13 and AC-20.

describe("moveId", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an item down or up to the position of the one it is over", () => {
    expect(moveId(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moveId(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the list as it was for the same or an unknown id", () => {
    expect(moveId(ids, "b", "b")).toBe(ids);
    expect(moveId(ids, "x", "b")).toBe(ids);
    expect(moveId(ids, "b", "x")).toBe(ids);
  });
});

describe("sortableAnnouncements", () => {
  it("names the item and its position at every step", () => {
    expect(sortableAnnouncements.start("Red tee photo", 1, 3)).toBe(
      "Picked up Red tee photo. Position 1 of 3.",
    );
    expect(sortableAnnouncements.over("Red tee photo", 2, 3)).toBe(
      "Red tee photo moved to position 2 of 3.",
    );
    expect(sortableAnnouncements.end("Red tee photo", 2, 3)).toBe(
      "Red tee photo dropped at position 2 of 3.",
    );
    expect(sortableAnnouncements.cancel("Red tee photo", 1, 3)).toBe(
      "Moving Red tee photo was cancelled. It stays at position 1 of 3.",
    );
  });
});
