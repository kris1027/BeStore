import { describe, expect, it } from "vitest";

import { signCartId, verifyCartCookie } from "./signature";

const secret = "s".repeat(32);
const cartId = "01923c4e-7b1a-7c3d-9e8f-0123456789ab";

// covers: spec 0005 AC-9
describe("cart cookie signature", () => {
  it("reads back the cart id it signed", () => {
    expect(verifyCartCookie(signCartId(cartId, secret), secret)).toBe(cartId);
  });

  it("refuses a tampered signature", () => {
    const value = signCartId(cartId, secret);
    const last = value.at(-1) === "A" ? "B" : "A";
    expect(verifyCartCookie(`${value.slice(0, -1)}${last}`, secret)).toBeNull();
  });

  it("refuses another cart id with a copied signature", () => {
    const signature = signCartId(cartId, secret).split(".")[1];
    const other = "01923c4e-7b1a-7c3d-9e8f-0123456789ac";
    expect(verifyCartCookie(`${other}.${signature}`, secret)).toBeNull();
  });

  it("refuses a value signed with another secret", () => {
    expect(verifyCartCookie(signCartId(cartId, "t".repeat(32)), secret)).toBeNull();
  });

  it.each(["", cartId, `${cartId}.`, "not-a-uuid.abc", `.${cartId}`, `${cartId}.a.b`])(
    "refuses the malformed value %j",
    (value) => {
      expect(verifyCartCookie(value, secret)).toBeNull();
    },
  );
});
