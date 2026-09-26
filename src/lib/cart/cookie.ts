import "server-only";

import { cookies } from "next/headers";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import { signCartId, verifyCartCookie } from "./signature";

export const CART_COOKIE = "bestore_cart";

// spec 0002: a cart lives 30 days from its last write, and so does its cookie.
export const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function cartExpiry(nowMs: number): Date {
  return new Date(nowMs + CART_TTL_MS);
}

// The cart id named by a validly signed cookie, or null. Whether that cart still exists and
// has not expired is the caller's check.
export async function readCartId(): Promise<string | null> {
  const value = (await cookies()).get(CART_COOKIE)?.value;
  if (value === undefined) return null;
  const cartId = verifyCartCookie(value, env.CART_COOKIE_SECRET);
  if (cartId === null) {
    // Never the value itself (spec 0005, AC-18).
    logger.warn({ event: "cart.cookie.invalid" }, "cart.cookie.invalid");
  }
  return cartId;
}

// Only server actions call this: rendering a page never sets a cookie (spec 0001).
export async function setCartCookie(cartId: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(CART_COOKIE, signCartId(cartId, env.CART_COOKIE_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}
