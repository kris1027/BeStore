import { describe, expect, it } from "vitest";

import { decideAccountProxy, isNoStorePath } from "./proxy-decision";

const base = { search: "", isServerAction: false, signedIn: false };

describe("decideAccountProxy (AC-13)", () => {
  it("sends a signed out visitor on an account page to sign in, keeping the path", () => {
    expect(
      decideAccountProxy({ ...base, pathname: "/account/orders/1042", search: "?x=1" }),
    ).toEqual({
      kind: "redirect",
      to: "/account/sign-in?next=%2Faccount%2Forders%2F1042%3Fx%3D1",
    });
    expect(decideAccountProxy({ ...base, pathname: "/account/set-password" })).toMatchObject({
      kind: "redirect",
    });
  });

  it.each(["/account/sign-in", "/account/sign-up", "/account/forgot-password", "/account/confirm"])(
    "lets anyone open the auth page %s",
    (pathname) => {
      expect(decideAccountProxy({ ...base, pathname })).toEqual({ kind: "continue" });
    },
  );

  it("lets a signed in visitor through", () => {
    expect(decideAccountProxy({ ...base, pathname: "/account", signedIn: true })).toEqual({
      kind: "continue",
    });
  });

  it("never redirects a server action", () => {
    expect(decideAccountProxy({ ...base, pathname: "/account", isServerAction: true })).toEqual({
      kind: "continue",
    });
  });

  it("leaves checkout alone", () => {
    expect(decideAccountProxy({ ...base, pathname: "/checkout" })).toEqual({ kind: "continue" });
  });

  it("marks only account pages no-store", () => {
    expect(isNoStorePath("/account/sign-in")).toBe(true);
    expect(isNoStorePath("/checkout")).toBe(false);
  });
});
