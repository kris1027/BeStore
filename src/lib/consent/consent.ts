import { z } from "zod";

// Pure. The consent choice (spec 0017, AC-15 to AC-21): the cookie's value, when a saved choice
// still counts, which cookies a withdrawal deletes and when the banner shows. Browser code in
// this folder calls these with document.cookie and Date.now(); nothing here touches either.

export const CONSENT_COOKIE = "bestore_consent";

export const consentCategories = ["necessary", "analytics", "marketing"] as const;
export type ConsentCategory = (typeof consentCategories)[number];

export const optionalCategories = ["analytics", "marketing"] as const;
export type OptionalCategory = (typeof optionalCategories)[number];

// 12 months, in the cookie's Max-Age seconds and in the age check's milliseconds.
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const consentMaxAgeMs = CONSENT_MAX_AGE_SECONDS * 1000;

export type CookieEntry = {
  // As the cookie table shows it, e.g. `sb-<project ref>-auth-token`.
  readonly name: string;
  // The names it covers in document.cookie, `*` matching any run of characters; null for a cookie
  // set on another domain (Stripe's page), which this site can neither see nor delete.
  readonly match: string | null;
  readonly category: ConsentCategory;
  readonly purpose: string;
  readonly lifetime: string;
  readonly setBy: string;
};

export type CookieRegistry = readonly CookieEntry[];

export type Choices = Readonly<Record<OptionalCategory, boolean>>;

export type ConsentChoice = Choices & {
  // The cookie policy's `updated` date the choice was made against.
  readonly v: string;
  // Epoch milliseconds of the choice.
  readonly at: number;
};

const choiceSchema = z.object({
  v: z.string().min(1),
  at: z.number().int().nonnegative(),
  analytics: z.boolean(),
  marketing: z.boolean(),
});

export const refusedAll: Choices = { analytics: false, marketing: false };

// A missing cookie, a value that is not our JSON, a choice made against another policy version,
// or one older than 12 months all read as "no choice yet" (AC-15).
export function parseConsent(
  raw: string | undefined,
  policyVersion: string,
  nowMs: number,
): ConsentChoice | null {
  if (raw === undefined || raw === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  const parsed = choiceSchema.safeParse(value);
  if (!parsed.success) return null;
  const choice = parsed.data;
  if (choice.v !== policyVersion || nowMs - choice.at > consentMaxAgeMs) return null;
  return choice;
}

// Only the four keys, in a fixed order, so the cookie never carries anything else.
export function serializeConsent(choice: ConsentChoice): string {
  const { v, at, analytics, marketing } = choice;
  return encodeURIComponent(JSON.stringify({ v, at, analytics, marketing }));
}

// The document.cookie assignment for a choice: no Domain (host only), so a withdrawal can delete
// on the same scope (AC-20).
export function consentCookieString(choice: ConsentChoice, secure: boolean): string {
  return [
    `${CONSENT_COOKIE}=${serializeConsent(choice)}`,
    "Path=/",
    `Max-Age=${CONSENT_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function expiredCookieString(name: string): string {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

// The value of one cookie in a document.cookie string.
export function readCookie(cookieString: string, name: string): string | undefined {
  for (const part of cookieString.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function cookieNames(cookieString: string): readonly string[] {
  return cookieString
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter((name) => name !== "");
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}

export function entryMatches(entry: CookieEntry, name: string): boolean {
  return entry.match !== null && globToRegExp(entry.match).test(name);
}

// Whether the registry lists any cookie of this category: a category with none is "Not used
// right now" in the dialog (AC-16), and with no optional category at all the banner never
// shows (AC-18).
export function categoryUsed(registry: CookieRegistry, category: ConsentCategory): boolean {
  return registry.some((entry) => entry.category === category);
}

// What a customer's choice amounts to: refused until they say yes, whatever GPC says (AC-21).
export function grantedChoices(choice: ConsentChoice | null): Choices {
  return choice === null
    ? refusedAll
    : { analytics: choice.analytics, marketing: choice.marketing };
}

// The categories a save turns from on to off: a reload follows, so a running script stops.
export function revokedCategories(previous: Choices, next: Choices): readonly OptionalCategory[] {
  return optionalCategories.filter((category) => previous[category] && !next[category]);
}

// AC-20: every cookie present now that the registry files under a category turned off.
export function cookiesToDelete(
  previous: Choices,
  next: Choices,
  registry: CookieRegistry,
  presentNames: readonly string[],
): readonly string[] {
  const revoked = revokedCategories(previous, next);
  const entries = registry.filter((entry) =>
    (revoked as readonly ConsentCategory[]).includes(entry.category),
  );
  return presentNames.filter((name) => entries.some((entry) => entryMatches(entry, name)));
}

// AC-18 and AC-21: an optional cookie exists, no valid choice was made, and the browser does not
// send Global Privacy Control.
export function shouldShowBanner(input: {
  readonly registry: CookieRegistry;
  readonly choice: ConsentChoice | null;
  readonly gpc: boolean;
}): boolean {
  const optionalUsed = optionalCategories.some((category) =>
    categoryUsed(input.registry, category),
  );
  return optionalUsed && input.choice === null && !input.gpc;
}

// Accept all turns on only what the registry uses; an unused category stays off (AC-16).
export function acceptAllChoices(registry: CookieRegistry): Choices {
  return {
    analytics: categoryUsed(registry, "analytics"),
    marketing: categoryUsed(registry, "marketing"),
  };
}
