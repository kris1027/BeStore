import { describe, expect, it } from "vitest";

import { safeAdminPath, signInPath } from "./safe-admin-path";

describe("safeAdminPath (AC-12)", () => {
  it.each([
    "//evil.test",
    "/\\evil.test",
    "https://evil.test",
    "javascript:alert(1)",
    "/admin-evil",
    "/admin/sign-in",
    "/admin/sign-in?next=/admin",
    "/admin/../evil",
    "/admin/%2e%2e/evil",
    "/admin/\tx",
    "/store",
    "admin",
    "",
    undefined,
    42,
  ])("rejects %j", (next) => {
    expect(safeAdminPath(next)).toBe("/admin");
  });

  it.each([
    ["/admin", "/admin"],
    ["/admin/orders/1?x=y", "/admin/orders/1?x=y"],
    // spec 0019: the removed auth pages are ordinary admin paths, which 404 after sign in.
    ["/admin/mfa", "/admin/mfa"],
    ["/admin/reset-password", "/admin/reset-password"],
    ["/admin/orders#top", "/admin/orders"],
  ])("accepts %j", (next, expected) => {
    expect(safeAdminPath(next)).toBe(expected);
  });
});

describe("redirect paths", () => {
  it("builds the sign in URL with a safe next and a reason", () => {
    expect(signInPath()).toBe("/admin/sign-in");
    expect(signInPath({ next: "/admin/orders?x=1" })).toBe(
      "/admin/sign-in?next=%2Fadmin%2Forders%3Fx%3D1",
    );
    expect(signInPath({ next: "//evil.test" })).toBe("/admin/sign-in?next=%2Fadmin");
    expect(signInPath({ reason: "expired" })).toBe("/admin/sign-in?reason=expired");
  });
});
