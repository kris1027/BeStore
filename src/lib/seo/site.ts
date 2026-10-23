import "server-only";

import { brand } from "@/lib/brand/brand";
import { env } from "@/lib/env";

import type { SiteFacts } from "./metadata";

// The site facts the pages hand to the pure SEO builders.
export const site: SiteFacts = {
  url: env.NEXT_PUBLIC_SITE_URL,
  name: brand.name,
  locale: env.STORE_LOCALE,
};
