import { CART_COOKIE } from "@/lib/cart/cookie-name";

import { CONSENT_COOKIE, type CookieRegistry } from "./consent";

// spec 0017, AC-17: every cookie the store sets. registry.test.ts fails when code sets a cookie
// this list does not name. An analytics or marketing entry makes the banner appear, and adding
// one means changing the /cookies `updated` date, which asks every visitor again.
export const cookieRegistry: CookieRegistry = [
  {
    name: CART_COOKIE,
    match: CART_COOKIE,
    category: "necessary",
    purpose: "Keeps your cart between visits. It holds a signed cart id, nothing else.",
    lifetime: "30 days after the cart last changed",
    setBy: "This store",
  },
  {
    name: CONSENT_COOKIE,
    match: CONSENT_COOKIE,
    category: "necessary",
    purpose: "Remembers your cookie choice, so we do not ask again on every page.",
    lifetime: "12 months",
    setBy: "This store",
  },
  {
    name: "sb-<project ref>-auth-token (and its numbered parts .0, .1, …)",
    match: "sb-*-auth-token*",
    category: "necessary",
    purpose: "Keeps you signed in to your account. Only set when you sign in.",
    lifetime: "Until you sign out, at most 400 days",
    setBy: "This store (through Supabase, our sign in provider)",
  },
  {
    name: "sidebar_state",
    match: "sidebar_state",
    category: "necessary",
    purpose: "Remembers whether the admin panel's sidebar is open. Only for store staff.",
    lifetime: "7 days",
    setBy: "This store",
  },
  {
    name: "Stripe's own cookies",
    match: null,
    category: "necessary",
    purpose:
      "Used by Stripe on its secure payment page to process your card payment and prevent fraud.",
    lifetime: "Set by Stripe, see Stripe's cookie policy",
    setBy: "Stripe, on its own domain (not ours)",
  },
];
