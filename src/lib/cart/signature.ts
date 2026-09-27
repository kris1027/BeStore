import { createHmac, timingSafeEqual } from "node:crypto";

// Pure signing for the cart cookie (spec 0005, AC-9): `<cartId>.<signature>`. The cart id is
// not secret, but without CART_COOKIE_SECRET nobody can name a cart that is not theirs.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function signature(cartId: string, secret: string): string {
  return createHmac("sha256", secret).update(cartId).digest("base64url");
}

export function signCartId(cartId: string, secret: string): string {
  return `${cartId}.${signature(cartId, secret)}`;
}

// The cart id when the value is well formed and signed with this secret, else null.
export function verifyCartCookie(value: string, secret: string): string | null {
  const dot = value.indexOf(".");
  if (dot === -1) return null;
  const cartId = value.slice(0, dot);
  if (!UUID_PATTERN.test(cartId)) return null;

  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(signature(cartId, secret));
  // timingSafeEqual throws on a length mismatch, and the length is no secret.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return cartId;
}
