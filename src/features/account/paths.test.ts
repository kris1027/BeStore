import { describe, expect, it } from "vitest";

import { isAccountAuthPage, isAccountPath, safeAccountNext, signInPath } from "./paths";

describe("safeAccountNext (AC-4)", () => {
  it.each([
    ["/checkout", "/checkout"],
    ["/account", "/account"],
    ["/account/orders/1042", "/account/orders/1042"],
    ["/account?page=2", "/account?page=2"],
    ["%2Faccount%2Faddresses", "/account/addresses"],
    ["/account/set-password", "/account/set-password"],
  ])("accepts %j", (next, expected) => {
    expect(safeAccountNext(next)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "account",
    "//evil.example",
    "/\\evil.example",
    "%2F%2Fevil.example",
    "https://evil.example/account",
    "/account//orders",
    "/checkout/complete",
    "/checkoutx",
    "/accounts",
    "/admin",
    "/account/sign-in",
    "/account/sign-up",
    "/account/forgot-password",
    "/account/confirm",
    "/account/javascript:alert(1)",
    "/account\n/orders",
    "%E0%A4%A",
    "/account/../admin",
    "/account/./sign-in",
    "/account/%2e%2e/admin",
    "%2Faccount%2F%252e%252e%2Fadmin",
    "/account/orders/..",
    "/account/sign-in/",
    "/account/",
  ])("refuses %j", (next) => {
    expect(safeAccountNext(next)).toBeNull();
  });
});

describe("account paths", () => {
  it("tells account pages and auth pages apart", () => {
    expect(isAccountPath("/account")).toBe(true);
    expect(isAccountPath("/account/orders/1")).toBe(true);
    expect(isAccountPath("/accounts")).toBe(false);
    expect(isAccountAuthPage("/account/confirm")).toBe(true);
    expect(isAccountAuthPage("/account/set-password")).toBe(false);
  });

  it("encodes the next path", () => {
    expect(signInPath("/account/orders/1?x=1")).toBe(
      "/account/sign-in?next=%2Faccount%2Forders%2F1%3Fx%3D1",
    );
    expect(signInPath()).toBe("/account/sign-in");
  });
});
