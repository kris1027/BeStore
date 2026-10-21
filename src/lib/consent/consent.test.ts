import { describe, expect, it } from "vitest";

import {
  acceptAllChoices,
  categoryUsed,
  choicesFrom,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  type ConsentChoice,
  consentCookieString,
  cookieNames,
  cookiesToDelete,
  type CookieRegistry,
  entryMatches,
  expiredCookieString,
  grantedChoices,
  optionalCategories,
  parseConsent,
  readCookie,
  refusedAll,
  revokedCategories,
  serializeConsent,
  shouldShowBanner,
} from "./consent";

// spec 0017, AC-15 to AC-21.

const version = "2026-10-20";
const now = Date.UTC(2026, 9, 20, 12);
const day = 24 * 60 * 60 * 1000;

const choice: ConsentChoice = { v: version, at: now - day, analytics: true, marketing: false };

const entry = (overrides: Partial<CookieRegistry[number]>): CookieRegistry[number] => ({
  name: "x",
  match: "x",
  category: "necessary",
  purpose: "p",
  lifetime: "l",
  setBy: "s",
  ...overrides,
});

const registry: CookieRegistry = [
  entry({ name: "bestore_cart", match: "bestore_cart" }),
  entry({ name: "_ga", match: "_ga*", category: "analytics" }),
  entry({ name: "_fbp", match: "_fbp", category: "marketing" }),
  entry({ name: "Stripe", match: null }),
];

describe("parseConsent", () => {
  it("reads back what serializeConsent wrote", () => {
    expect(parseConsent(serializeConsent(choice), version, now)).toEqual(choice);
  });

  it("writes URL encoded JSON with the four keys only", () => {
    const extra = { ...choice, email: "a@b.c" } as ConsentChoice;
    expect(JSON.parse(decodeURIComponent(serializeConsent(extra)))).toEqual({
      v: version,
      at: choice.at,
      analytics: true,
      marketing: false,
    });
  });

  it.each([
    ["a missing cookie", undefined],
    ["an empty value", ""],
    ["text that is not JSON", "hello"],
    ["broken URL encoding", "%E0%A4%A"],
    ["JSON of the wrong shape", encodeURIComponent(JSON.stringify({ v: version, at: now }))],
    [
      "a string for a flag",
      serializeConsent({ ...choice, analytics: "yes" as unknown as boolean }),
    ],
    ["another policy version", serializeConsent({ ...choice, v: "2026-01-01" })],
    ["a choice older than 12 months", serializeConsent({ ...choice, at: now - 366 * day })],
  ])("reads %s as no choice yet", (_, raw) => {
    expect(parseConsent(raw, version, now)).toBeNull();
  });

  it("still counts a choice made just under 12 months ago", () => {
    const old = { ...choice, at: now - 364 * day };
    expect(parseConsent(serializeConsent(old), version, now)).toEqual(old);
  });
});

describe("consentCookieString", () => {
  it("is host only, on /, Lax, 12 months, and Secure only on https", () => {
    const http = consentCookieString(choice, false);
    expect(http).toBe(
      `${CONSENT_COOKIE}=${serializeConsent(choice)}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax`,
    );
    expect(http).not.toMatch(/domain|httponly/i);
    expect(consentCookieString(choice, true)).toMatch(/; Secure$/);
    expect(CONSENT_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
  });

  it("deletes a cookie on the same scope", () => {
    expect(expiredCookieString("_ga")).toBe("_ga=; Path=/; Max-Age=0; SameSite=Lax");
  });
});

describe("reading document.cookie", () => {
  const jar = "a=1; bestore_consent=%7B%7D; sb-ref-auth-token.0=x=y";

  it("finds one value, keeping an = inside it", () => {
    expect(readCookie(jar, "bestore_consent")).toBe("%7B%7D");
    expect(readCookie(jar, "sb-ref-auth-token.0")).toBe("x=y");
    expect(readCookie(jar, "missing")).toBeUndefined();
  });

  it("lists the names", () => {
    expect(cookieNames(jar)).toEqual(["a", "bestore_consent", "sb-ref-auth-token.0"]);
    expect(cookieNames("")).toEqual([]);
  });
});

describe("entryMatches", () => {
  it("matches a name or a * pattern, never a cookie on another domain", () => {
    const supabase = entry({ match: "sb-*-auth-token*" });
    expect(entryMatches(supabase, "sb-abc-auth-token")).toBe(true);
    expect(entryMatches(supabase, "sb-abc-auth-token.1")).toBe(true);
    expect(entryMatches(supabase, "xsb-abc-auth-token")).toBe(false);
    expect(entryMatches(entry({ match: "a.b" }), "aXb")).toBe(false);
    expect(entryMatches(entry({ match: null }), "anything")).toBe(false);
  });
});

describe("withdrawal (AC-20)", () => {
  const on = { analytics: true, marketing: true };

  it("deletes only present cookies of the categories turned off", () => {
    expect(
      cookiesToDelete(on, { analytics: false, marketing: true }, registry, [
        "bestore_cart",
        "_ga",
        "_ga_XYZ",
        "_fbp",
        "other",
      ]),
    ).toEqual(["_ga", "_ga_XYZ"]);
  });

  it("deletes nothing when nothing is turned off", () => {
    expect(cookiesToDelete(refusedAll, on, registry, ["_ga", "_fbp"])).toEqual([]);
    expect(revokedCategories(refusedAll, on)).toEqual([]);
  });

  it("names the categories turned off, which trigger the reload", () => {
    expect(revokedCategories(on, refusedAll)).toEqual(["analytics", "marketing"]);
  });
});

describe("shouldShowBanner (AC-18, AC-21)", () => {
  const necessaryOnly: CookieRegistry = [entry({})];

  it("shows only with an optional cookie, no choice and no GPC", () => {
    expect(shouldShowBanner({ registry, choice: null, gpc: false })).toBe(true);
    expect(shouldShowBanner({ registry: necessaryOnly, choice: null, gpc: false })).toBe(false);
    expect(shouldShowBanner({ registry, choice, gpc: false })).toBe(false);
    expect(shouldShowBanner({ registry, choice: null, gpc: true })).toBe(false);
  });
});

describe("what is granted", () => {
  it("is nothing until a choice is made, GPC or not", () => {
    expect(grantedChoices(null)).toEqual(refusedAll);
    expect(grantedChoices(choice)).toEqual({ analytics: true, marketing: false });
  });

  it("accept all turns on only the categories the registry uses", () => {
    expect(acceptAllChoices(registry)).toEqual({ analytics: true, marketing: true });
    expect(acceptAllChoices([entry({ category: "analytics" })])).toEqual({
      analytics: true,
      marketing: false,
    });
    expect(categoryUsed([entry({})], "marketing")).toBe(false);
  });
});

describe("choicesFrom", () => {
  it("answers once for every optional category and nothing else", () => {
    const asked: string[] = [];
    const choices = choicesFrom((category) => {
      asked.push(category);
      return category === "analytics";
    });

    expect(asked).toEqual([...optionalCategories]);
    expect(choices).toEqual({ analytics: true, marketing: false });
  });
});
