import "server-only";

import { brand } from "@/lib/brand/brand";
import { env } from "@/lib/env";
import { countryDisplayName } from "@/lib/shipping/address";

import cookies from "./content/cookies.md";
import privacy from "./content/privacy.md";
import returns from "./content/returns.md";
import shipping from "./content/shipping.md";
import terms from "./content/terms.md";
import { loadLegalDocuments } from "./load";

// spec 0017: the texts are bundled as strings at build time (next.config.ts and the Vitest
// config), never read with fs, so a revalidated /shipping render and startCheckout never depend
// on file tracing. Parsed once here; a broken file or a blank left in production throws.
export const legalDocuments = loadLegalDocuments(
  { terms, privacy, returns, shipping, cookies },
  {
    seller: brand.legal,
    store: {
      country: countryDisplayName(env.STORE_COUNTRY, env.STORE_LOCALE),
      currency: env.STORE_CURRENCY,
    },
    production: env.VERCEL_ENV === "production",
  },
);

// The version a checkout accepts (AC-9) and the one the consent cookie records (AC-15).
export const currentTermsVersion = legalDocuments.terms.updated;
export const cookiePolicyVersion = legalDocuments.cookies.updated;
