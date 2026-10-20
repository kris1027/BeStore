// Pure, no server import: client components and the email builder link to the legal pages
// without pulling in their texts (spec 0017, Module layout).

export const legalSlugs = ["terms", "privacy", "returns", "shipping", "cookies"] as const;

export type LegalSlug = (typeof legalSlugs)[number];

export const legalPaths: Readonly<Record<LegalSlug, `/${LegalSlug}`>> = {
  terms: "/terms",
  privacy: "/privacy",
  returns: "/returns",
  shipping: "/shipping",
  cookies: "/cookies",
};

// The footer's order (AC-3).
export const legalLinkLabels: Readonly<Record<LegalSlug, string>> = {
  terms: "Terms of sale",
  privacy: "Privacy policy",
  returns: "Returns",
  shipping: "Shipping",
  cookies: "Cookie policy",
};
