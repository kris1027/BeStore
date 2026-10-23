import type { MetadataRoute } from "next";

// Pure (spec 0018, AC-20): only production allows crawling. Any other value, or none (local, CI),
// blocks everything, so a preview catalog never competes with the real store. Cart, checkout,
// account and search stay crawlable on purpose: a bot must fetch them to read their noindex.
export function robotsRules(vercelEnv: string | undefined, siteUrl: string): MetadataRoute.Robots {
  if (vercelEnv !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/auth"] },
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}
