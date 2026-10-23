import "server-only";

import type { Metadata } from "next";

import { brand } from "@/lib/brand/brand";
import { env } from "@/lib/env";

import { type PageSeo, pageMetadata, type SiteFacts, type StoreFacts } from "./metadata";

// The env bound side of the SEO builders: they stay pure and take these facts as an argument, so
// their tests pass their own facts without mocking env.
export const site: SiteFacts = {
  url: env.NEXT_PUBLIC_SITE_URL,
  name: brand.name,
  locale: env.STORE_LOCALE,
};

export const store: StoreFacts = {
  ...site,
  currency: env.STORE_CURRENCY,
  country: env.STORE_COUNTRY,
};

// What a route's metadata export calls.
export function storePageMetadata(page: PageSeo): Metadata {
  return pageMetadata(page, site);
}
