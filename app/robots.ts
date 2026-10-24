import type { MetadataRoute } from "next";

import { env } from "@/lib/env";
import { robotsRules } from "@/lib/seo/robots";

// spec 0018, AC-20: prerendered at build, which is right because Vercel builds each production
// deployment with VERCEL_ENV=production and every other build blocks crawling.
export default function robots(): MetadataRoute.Robots {
  return robotsRules(env.VERCEL_ENV, env.NEXT_PUBLIC_SITE_URL);
}
