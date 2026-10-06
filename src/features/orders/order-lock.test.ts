import { describe, expect, it, vi } from "vitest";

import { isStale, type LockedOrder } from "./order-lock";

vi.mock("server-only", () => ({}));

// spec 0010, AC-8: a form posted from a page rendered before the order last changed is refused.

const order = {
  updatedAt: new Date("2026-10-05T10:00:00.123Z"),
} as LockedOrder;

describe("isStale", () => {
  it("is fresh when the form carries the row's updated_at", () => {
    expect(isStale(order, "2026-10-05T10:00:00.123Z")).toBe(false);
  });

  it("compares instants, so the same moment in another offset is fresh", () => {
    expect(isStale(order, "2026-10-05T12:00:00.123+02:00")).toBe(false);
  });

  it("is stale one millisecond either side", () => {
    expect(isStale(order, "2026-10-05T10:00:00.122Z")).toBe(true);
    expect(isStale(order, "2026-10-05T10:00:00.124Z")).toBe(true);
  });
});
