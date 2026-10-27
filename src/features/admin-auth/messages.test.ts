import { describe, expect, it } from "vitest";

import { signInReason } from "./messages";

// The sign in page maps its `reason` query param through this, so nothing from the URL is ever
// echoed onto the page (spec 0004, value sourcing).
describe("signInReason", () => {
  it.each(["expired", "signed_out"] as const)("accepts the fixed reason %s", (reason) => {
    expect(signInReason(reason)).toBe(reason);
  });

  it.each([
    ["markup", "<script>alert(1)</script>"],
    ["another message key", "invalid_credentials"],
    ["an old reset link bookmark (spec 0019, AC-5)", "invalid_link"],
    ["an old wrong code bookmark (spec 0019, AC-5)", "too_many_codes"],
    ["a different case", "EXPIRED"],
    ["an empty string", ""],
    ["an array from a repeated param", ["expired"]],
    ["undefined", undefined],
  ])("returns null for %s", (_label, value) => {
    expect(signInReason(value)).toBeNull();
  });
});
