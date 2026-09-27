import { describe, expect, it } from "vitest";

import { uniqueViolation } from "./db-errors";

function adapterError(code: string, message: string) {
  return Object.assign(new Error("query failed"), {
    meta: { driverAdapterError: { cause: { originalCode: code, originalMessage: message } } },
  });
}

describe("uniqueViolation", () => {
  it("names the constraint of a unique violation", () => {
    const error = adapterError(
      "23505",
      'duplicate key value violates unique constraint "products_slug_key"',
    );
    expect(uniqueViolation(error)).toBe("products_slug_key");
  });

  it("ignores other SQLSTATEs and other errors", () => {
    expect(uniqueViolation(adapterError("23514", 'violates check constraint "x"'))).toBeNull();
    expect(uniqueViolation(new Error("boom"))).toBeNull();
    expect(uniqueViolation(null)).toBeNull();
  });
});
