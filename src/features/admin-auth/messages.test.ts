import { describe, expect, it } from "vitest";

import { signInReason } from "./messages";

// The sign in page maps its `reason` query param through this, so nothing from the URL is ever
// echoed onto the page (spec 0004, value sourcing).
describe("signInReason", () => {
  it.each(["expired", "signed_out", "invalid_link", "too_many_codes"] as const)(
    "accepts the fixed reason %s",
    (reason) => {
      expect(signInReason(reason)).toBe(reason);
    },
  );

  it.each([
    ["markup", "<script>alert(1)</script>"],
    ["another message key", "invalid_credentials"],
    ["a different case", "EXPIRED"],
    ["an empty string", ""],
    ["an array from a repeated param", ["expired"]],
    ["undefined", undefined],
  ])("returns null for %s", (_label, value) => {
    expect(signInReason(value)).toBeNull();
  });
});
