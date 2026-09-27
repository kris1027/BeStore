import { beforeEach, describe, expect, it, vi } from "vitest";

import { signCartId } from "./signature";

// spec 0005, AC-9 and AC-18: the cart cookie's attributes, and a forged one read as no cart.

const secret = "c".repeat(32);
const cartId = "0192f1c4-7b2e-7a10-9c3d-4e5f6a7b8c9d";

const mocks = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  warn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { CART_COOKIE_SECRET: "c".repeat(32) } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: mocks.warn } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = mocks.jar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options?: Record<string, unknown>) =>
      mocks.jar.set(name, { value, options }),
  }),
}));

const { CART_COOKIE, CART_TTL_MS, cartExpiry, readCartId, setCartCookie } =
  await import("./cookie");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jar.clear();
});

describe("cartExpiry", () => {
  it("is 30 days after the given instant", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(CART_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(cartExpiry(now).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});

describe("setCartCookie", () => {
  it("sets a signed, HttpOnly, SameSite Lax cookie on / that expires with the cart", async () => {
    const expiresAt = cartExpiry(Date.now());

    await setCartCookie(cartId, expiresAt);

    const cookie = mocks.jar.get(CART_COOKIE);
    expect(CART_COOKIE).toBe("bestore_cart");
    expect(cookie?.value).toBe(signCartId(cartId, secret));
    expect(cookie?.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  });

  it("is Secure only in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await setCartCookie(cartId, cartExpiry(Date.now()));
    expect(mocks.jar.get(CART_COOKIE)?.options?.secure).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    await setCartCookie(cartId, cartExpiry(Date.now()));
    expect(mocks.jar.get(CART_COOKIE)?.options?.secure).toBe(false);
  });
});

describe("readCartId", () => {
  it("reads back the cart id from a validly signed cookie", async () => {
    mocks.jar.set(CART_COOKIE, { value: signCartId(cartId, secret) });

    expect(await readCartId()).toBe(cartId);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("is null without a cookie, and logs nothing", async () => {
    expect(await readCartId()).toBeNull();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("treats a forged cookie as no cart and logs it without the value", async () => {
    const forged = `${cartId}.${"A".repeat(43)}`;
    mocks.jar.set(CART_COOKIE, { value: forged });

    expect(await readCartId()).toBeNull();
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.warn.mock.calls[0]?.[0]).toEqual({ event: "cart.cookie.invalid" });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(cartId);
  });
});
