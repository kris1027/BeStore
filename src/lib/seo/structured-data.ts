import type { BreadcrumbList, Organization, WebSite, WithContext } from "schema-dts";

import { absoluteUrl, logoPath, type SiteFacts } from "./metadata";

// Pure: the site wide JSON-LD (spec 0018, AC-15 and AC-16). No SearchAction: search results are
// noindex, so a sitelinks search box would point at pages kept out of the index.

export function organizationJsonLd(site: SiteFacts): WithContext<Organization> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    url: absoluteUrl("/", site),
    logo: absoluteUrl(logoPath, site),
  };
}

export function websiteJsonLd(site: SiteFacts): WithContext<WebSite> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: absoluteUrl("/", site),
  };
}

export type Crumb = { readonly name: string; readonly path: string };

// The site home first, then the given pages in order.
export function breadcrumbJsonLd(
  site: SiteFacts,
  crumbs: readonly Crumb[],
): WithContext<BreadcrumbList> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: site.name, path: "/" }, ...crumbs].map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path, site),
    })),
  };
}
