import { describe, expect, it } from "vitest";

import { uuidv7 } from "./uuid";

describe("uuidv7", () => {
  it("is a version 7, variant 1 uuid", () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("starts with the timestamp, so later ids sort after earlier ones", () => {
    const early = uuidv7(1_790_000_000_000);
    const late = uuidv7(1_790_000_000_001);
    expect(early < late).toBe(true);
    expect(early.replace(/-/g, "").slice(0, 12)).toBe(
      (1_790_000_000_000).toString(16).padStart(12, "0"),
    );
  });

  it("never repeats", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(0)));
    expect(ids.size).toBe(1000);
  });
});
